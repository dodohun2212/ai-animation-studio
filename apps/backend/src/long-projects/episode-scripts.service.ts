import * as fs from "node:fs/promises";
import { isBudgetLedgerUnreadable } from "../providers/budget-ledger.js";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { errorsOf as episodeErrors, toEpisodeInstagramPost, toEpisodeUsedAudio } from "./episode-detail.js";
import { LONG_EPISODE_STATUSES, MAX_SCENE_COUNT, MIN_SCENE_COUNT, RUNWAY_CLIP_DURATIONS, STORY_ESTIMATED_COST_USD, type ApproveLongEpisodeScriptRequest, type ApproveLongEpisodeScriptResponse, type GenerateLongEpisodeScriptRequest, type GenerateLongEpisodeScriptResponse, type GetLongEpisodeResponse, type GetLongEpisodeSettingsResponse, type LongEpisodeDetail, type LongEpisodeOutline, type LongEpisodeScene, type LongEpisodeScript, type LongEpisodeStatus, type SceneNumber, type UpdateLongEpisodeScriptRequest, type UpdateLongEpisodeScriptResponse, type UpdateLongEpisodeSettingsRequest, type UpdateLongEpisodeSettingsResponse, type RunwayClipDurationSeconds } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { resolveSafeProjectDirectory } from "../projects/project-id.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError } from "../providers/openai-common.js";
import { callOpenAiStoryApi } from "../story/openai-story-adapter.js";
import { buildEpisodeContext } from "./episode-context-builder.js";
import { longBudgetLedgerUnreadable, isLongProjectError, longEpisodeNotFound, longEpisodeScriptBudgetExceeded, longEpisodeScriptExists, longEpisodeScriptNotAllowed, longEpisodeScriptProviderError, longEpisodeSettingsNotAllowed, longInvalidData, longLocked, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { episodeSettings } from "./episode-settings.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { storyBibleBasicForPrompt } from "./story-bible-basic.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";
import { LongProjectsService } from "./long-projects.service.js";

const snakeKeys = ["number", "description", "visual_action", "start_motion", "main_motion", "end_motion", "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject", "camera_motion", "environment_motion", "motion_speed", "motion_intensity", "expression_change", "continuity_hint"] as const;
const camelKeys = ["number", "description", "visualAction", "startMotion", "mainMotion", "endMotion", "shotSize", "cameraAngle", "composition", "lensFeel", "focusSubject", "cameraMotion", "environmentMotion", "motionSpeed", "motionIntensity", "expressionChange", "continuityHint"] as const;
type StoredEpisode = { episode_id: string; number: number; title: string; summary: string; core_event: string; conflict: string; cliffhanger: string; next_connection: string; duration_seconds: number; scene_count: number; approved: boolean; state: LongEpisodeStatus; script: Record<string, unknown>; script_history: unknown[]; script_revision: number; outline: Record<string, unknown>; updated_at: string; last_script_request_id?: string; instagram_post?: unknown; used_audio?: unknown };

const asObject = (value: unknown, error = longInvalidData): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw error(); return value as Record<string, unknown>; };
const isObj = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const asText = (value: unknown, error = longInvalidData): string => { if (typeof value !== "string") throw error(); return value.trim(); };
const asNumber = (value: unknown, error = longInvalidData): number => { if (!Number.isInteger(value)) throw error(); return value as number; };
const statuses: readonly LongEpisodeStatus[] = LONG_EPISODE_STATUSES;
/** A continuity memo that is not there, or is there and cannot be parsed — the two states a script must survive. */
const isAbsentOrUnreadableMemo = (error: unknown): boolean =>
  isLongProjectError(error, "LONG_PROJECT_NOT_FOUND", "LONG_PROJECT_JSON_MALFORMED", "LONG_PROJECT_DATA_INVALID");

@Injectable()
export class EpisodeScriptsService {
  private readonly projects: LongProjectsService;
  constructor(
    private readonly projectsRoot: string,
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
    // Defaulted the way StoryBibleService does it, so the module factory stays as it is. Only the protagonist's
    // name is read from it — the script prompt has no use for anything else in the library.
    private readonly assets = new LocalAssetsRepository(path.dirname(projectsRoot)),
  ) { this.projects = new LongProjectsService(projectsRoot); }

  private root(projectId: string): string { return longStoryRoot(this.projectsRoot, projectId); }
  private files(projectId: string, number: number) { const root = this.root(projectId); const episode = path.join(root, episodeDirectoryName(number)); return { root, project: path.join(root, "project.json"), outlines: path.join(root, "episode_outlines.json"), bible: path.join(root, "story_bible.json"), episode, episodeProject: path.join(episode, "project.json"), outline: path.join(episode, "outline.json"), script: path.join(episode, "script.json") }; }
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  private async outline(projectId: string, number: number): Promise<LongEpisodeOutline> {
    if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound();
    const raw = await this.json(this.files(projectId, number).outlines);
    if (!Array.isArray(raw)) throw longInvalidData();
    if (number > raw.length) throw longEpisodeNotFound();
    const item = raw[number - 1]; const d = asObject(item);
    if (d.episode_number !== number || !statuses.includes(d.status as LongEpisodeStatus) || ["title", "summary", "main_event", "conflict", "cliffhanger", "next_episode_hook"].some((key) => typeof d[key] !== "string")) throw longInvalidData();
    const warnings = withoutStaleEpisodeRecoveryWarnings(Array.isArray(d.warnings) ? d.warnings.filter((item): item is string => typeof item === "string") : [], d.status as string);
    return { episodeNumber: number, title: d.title as string, summary: d.summary as string, mainEvent: d.main_event as string, conflict: d.conflict as string, cliffhanger: d.cliffhanger as string, nextEpisodeHook: d.next_episode_hook as string, status: d.status as LongEpisodeStatus, ...(warnings.length > 0 ? { warnings } : {}) };
  }
  private parseScript(value: unknown, sceneCount: number, error = longInvalidData): LongEpisodeScript {
    const d = asObject(value, error); if (Object.keys(d).length !== 4 || typeof d.title !== "string" || typeof d.synopsis !== "string" || typeof d.ending !== "string" || !Array.isArray(d.scenes) || d.scenes.length !== sceneCount) throw error();
    // "narration" is optional (see LongEpisodeScene.narration's doc comment) — a scene has exactly the base
    // fields, or the base fields plus narration; anything else (missing base field, unrecognized extra key,
    // duplicate) is rejected the same as before.
    const scenes = d.scenes.map((item, index) => {
      const scene = asObject(item, error); const sourceKeys = "visualAction" in scene ? camelKeys : snakeKeys;
      const hasNarration = "narration" in scene;
      if (Object.keys(scene).length !== sourceKeys.length + (hasNarration ? 1 : 0) || sourceKeys.some((key) => !(key in scene)) || scene.number !== index + 1 || sourceKeys.slice(1).some((key) => typeof scene[key] !== "string") || !String(scene.description).trim()) throw error();
      if (hasNarration && typeof scene.narration !== "string") throw error();
      return Object.fromEntries([...camelKeys.map((key, itemIndex) => [key, scene[sourceKeys[itemIndex]!]]), ...(hasNarration ? [["narration", scene.narration]] : [])]) as unknown as LongEpisodeScene;
    });
    return { title: d.title, synopsis: d.synopsis, ending: d.ending, scenes };
  }
  private storedScript(script: LongEpisodeScript): Record<string, unknown> { return { title: script.title, synopsis: script.synopsis, ending: script.ending, scenes: script.scenes.map((scene) => ({ ...Object.fromEntries(snakeKeys.map((key, index) => [key, scene[camelKeys[index]!]])), ...(scene.narration !== undefined ? { narration: scene.narration } : {}) })) }; }
  private async stored(projectId: string, outline: LongEpisodeOutline): Promise<StoredEpisode> {
    const files = this.files(projectId, outline.episodeNumber);
    try { return this.parseStored(await this.json(files.episodeProject), outline); } catch (error) { if (!(error instanceof Error) || !("getStatus" in error) || (error as { getStatus(): number }).getStatus() !== 404) throw error; const projectSettings = (await this.projects.get(projectId)).project.settings; return { episode_id: `${projectId}-episode-${outline.episodeNumber}`, number: outline.episodeNumber, title: outline.title, summary: outline.summary, core_event: outline.mainEvent, conflict: outline.conflict, cliffhanger: outline.cliffhanger, next_connection: outline.nextEpisodeHook, duration_seconds: projectSettings.episodeDurationSeconds, scene_count: projectSettings.sceneCount, approved: false, state: outline.status, script: {}, script_history: [], script_revision: 0, outline: { episode_number: outline.episodeNumber, title: outline.title, summary: outline.summary, main_event: outline.mainEvent, conflict: outline.conflict, cliffhanger: outline.cliffhanger, next_episode_hook: outline.nextEpisodeHook }, updated_at: new Date().toISOString() }; }
  }
  /** A project stored before scene_count existed (per-episode, snapshotted the same way duration_seconds already was) has no such field — falls back to 6, matching every Episode created back then. */
  private parseStored(value: unknown, outline: LongEpisodeOutline): StoredEpisode { const d = asObject(value); if (d.number !== outline.episodeNumber || !statuses.includes(d.state as LongEpisodeStatus) || typeof d.approved !== "boolean" || !Array.isArray(d.script_history) || !Number.isInteger(d.script_revision) || Number(d.script_revision) < 0) throw longInvalidData(); const result: StoredEpisode = { episode_id: asText(d.episode_id), number: outline.episodeNumber, title: asText(d.title), summary: asText(d.summary), core_event: asText(d.core_event), conflict: asText(d.conflict), cliffhanger: asText(d.cliffhanger), next_connection: asText(d.next_connection), duration_seconds: asNumber(d.duration_seconds), scene_count: Number.isInteger(d.scene_count) ? d.scene_count as number : 6, approved: d.approved, state: d.state as LongEpisodeStatus, script: asObject(d.script), script_history: d.script_history, script_revision: d.script_revision as number, outline: asObject(d.outline), updated_at: asText(d.updated_at), ...(typeof d.last_script_request_id === "string" ? { last_script_request_id: d.last_script_request_id } : {}), ...(d.instagram_post !== undefined ? { instagram_post: d.instagram_post } : {}), ...(d.used_audio !== undefined ? { used_audio: d.used_audio } : {}), ...(d.errors !== undefined ? { errors: d.errors } : {}), ...(d.final_video_path !== undefined ? { final_video_path: d.final_video_path } : {}) }; return result; }
  private toApi(outline: LongEpisodeOutline, stored: StoredEpisode): LongEpisodeDetail { const script = Object.keys(stored.script).length ? this.parseScript(stored.script, stored.scene_count) : undefined; return { ...outline, status: stored.state, approved: stored.approved, scriptRevision: stored.script_revision, ...(script ? { script } : {}), scriptHistoryCount: stored.script_history.length, updatedAt: typeof stored.updated_at === "string" ? stored.updated_at : new Date(0).toISOString(), ...(toEpisodeInstagramPost(stored.instagram_post) ? { instagramPost: toEpisodeInstagramPost(stored.instagram_post)! } : {}), ...(toEpisodeUsedAudio(stored.used_audio) ? { usedAudio: toEpisodeUsedAudio(stored.used_audio)! } : {}), ...(episodeErrors(stored).length > 0 ? { errors: episodeErrors(stored) } : {}), ...(typeof (stored as Record<string, unknown>).final_video_path === "string" && (stored as Record<string, unknown>).final_video_path ? { finalVideoPath: (stored as Record<string, unknown>).final_video_path as string } : {}) }; }
  private async save(projectId: string, outline: LongEpisodeOutline, stored: StoredEpisode): Promise<LongEpisodeDetail> { const files = this.files(projectId, outline.episodeNumber); const outlines = await this.json(files.outlines); if (!Array.isArray(outlines)) throw longInvalidData(); const copy = [...outlines]; const current = asObject(copy[outline.episodeNumber - 1]); current.status = stored.state; copy[outline.episodeNumber - 1] = current; try { await fs.mkdir(files.episode, { recursive: true }); await Promise.all([atomicWriteUtf8File(files.episodeProject, JSON.stringify(stored, null, 2)), atomicWriteUtf8File(files.outline, JSON.stringify(stored.outline, null, 2)), atomicWriteUtf8File(files.script, JSON.stringify(stored.script, null, 2)), atomicWriteUtf8File(files.outlines, JSON.stringify(copy, null, 2))]); } catch { throw longStorageError(); } return this.toApi({ ...outline, status: stored.state }, stored); }
  private async bibleContext(projectId: string): Promise<string> { const bible = asObject(await this.json(this.files(projectId, 1).bible)); const names = ["characters", "locations", "props"].flatMap((collection) => Array.isArray(bible[collection]) ? bible[collection].map((item) => asObject(item).name).filter((name): name is string => typeof name === "string" && Boolean(name.trim())) : []); return names.join(", "); }
  /**
   * Every earlier Episode's memo, split into the three most recent and the rest.
   *
   * A memo that is absent is skipped, and so is one that cannot be parsed. The memo is optional by design —
   * nothing writes it automatically — so one unreadable file must not be able to stop a script from being
   * written, any more than an unreadable Asset folder stops one (docs/01_CURRENT_PRODUCT_SPEC.md says that
   * about the protagonist link, and protagonistName() below is built the same way). It used to throw:
   * `this.json()` raises LONG_PROJECT_JSON_MALFORMED for bad JSON and only 404 was caught, so a single corrupt
   * continuity.json made every later Episode's script ungeneratable — and the screen that would let a person
   * rewrite that memo refused to open for the same reason, so there was no way out from inside the app.
   *
   * Silent here on purpose, and not silent to the person: `LongEpisodeOutline.continuitySaved` reports false
   * for a memo that cannot be read, which is what the timeline and the pre-generation warning are built on.
   */
  private async continuityContext(projectId: string, episodeNumber: number): Promise<Record<string, unknown>> { const recent: unknown[] = []; const older: unknown[] = []; for (let number = 1; number < episodeNumber; number += 1) { try { const raw = asObject(await this.json(path.join(this.files(projectId, number).episode, "continuity.json"))); const record = { episodeNumber: number, summary: typeof raw.episode_summary === "string" ? raw.episode_summary : "", events: Array.isArray(raw.events) ? raw.events.filter((value): value is string => typeof value === "string") : [], characterChanges: Array.isArray(raw.character_changes) ? raw.character_changes.filter((value) => value && typeof value === "object" && !Array.isArray(value)) : [], nextActions: Array.isArray(raw.next_actions) ? raw.next_actions.filter((value): value is string => typeof value === "string") : [] }; (number >= episodeNumber - 3 ? recent : older).push(record); } catch (error) { if (!isAbsentOrUnreadableMemo(error)) throw error; } } return { recentContinuity: recent, olderCompressedSummaries: older.map((value) => ({ episodeNumber: (value as { episodeNumber: number }).episodeNumber, summary: (value as { summary: string }).summary })) }; }
  /**
   * The protagonist's name, read from the Folder the project points at.
   *
   * This is the first path that puts a character name into a real script prompt: `buildEpisodeContext`'s
   * `characters` list has always been empty, and the Story Bible's own character collection never reached it,
   * so scripts were written without knowing who they were about.
   *
   * The name is read at prompt time rather than copied when the link is saved. A copy would go stale the moment
   * the Folder is renamed — the same shape as the settings copy in `basic` and the Episode title, both of which
   * this repository has already had to repair.
   *
   * A link pointing at something unreadable yields no name instead of an error: a missing library file must not
   * be able to block generating a script.
   */
  private async protagonistName(basic: unknown): Promise<string | undefined> {
    const link = isObj(basic) ? basic.protagonist_asset_link : undefined;
    const assetId = isObj(link) && typeof link.asset_id === "string" ? link.asset_id : undefined;
    if (!assetId) return undefined;
    try {
      const name = (await this.assets.get(assetId)).display_name;
      return typeof name === "string" && name.trim() ? name : undefined;
    } catch { return undefined; }
  }

  /** A direct port of Python's build_context()/StoryContextBuilder.build() call site — assembles the same payload episode-context-builder.ts's buildEpisodeContext() truncates and returns. candidate_assets is deliberately omitted: Asset Mapping review only ever begins after a script is script_approved (generate()'s own allowed-state list ends there), so at every point this can run there are never any candidates yet — matching Python's own `if asset_context:` being empty in that same window, not a TS gap. */
  private async buildContext(projectId: string, outline: LongEpisodeOutline, stored: StoredEpisode, userInstruction = ""): Promise<Record<string, unknown>> {
    const bible = asObject(await this.json(this.files(projectId, 1).bible));
    const projectSettings = (await this.projects.get(projectId)).project.settings;
    const protagonist = await this.protagonistName(bible.basic);
    const projectOverview = {
      ...(protagonist ? { protagonist } : {}),
      title: projectSettings.title, logline: projectSettings.logline, overview: projectSettings.overview,
      genre: projectSettings.genre, tone: projectSettings.tone, theme: projectSettings.theme,
      episode_count: projectSettings.episodeCount, episode_duration_seconds: projectSettings.episodeDurationSeconds,
      ending_direction: projectSettings.endingDirection, aspect_ratio: projectSettings.aspectRatio,
      audience: projectSettings.audience, notes: projectSettings.notes, starting_state: projectSettings.startingState,
      midpoint: projectSettings.midpoint, story_flow_summary: projectSettings.storyFlowSummary,
    };
    const continuity = await this.continuityContext(projectId, outline.episodeNumber);
    const recentContinuity = (continuity.recentContinuity as Array<{ episodeNumber: number; summary: string; events: string[]; characterChanges: unknown[]; nextActions: string[] }>)
      .map((item) => ({ episode_number: item.episodeNumber, summary: item.summary, events: item.events, character_changes: item.characterChanges, next_actions: item.nextActions }));
    const olderCompressedSummaries = (continuity.olderCompressedSummaries as Array<{ episodeNumber: number; summary: string }>)
      .map((item) => ({ episode_number: item.episodeNumber, summary: item.summary }));
    return buildEpisodeContext({
      storyBible: { basic: storyBibleBasicForPrompt(bible.basic), world: isObj(bible.world) ? bible.world : {} },
      projectOverview,
      episodeOutline: stored.outline,
      recentContinuity,
      olderCompressedSummaries,
      secrets: Array.isArray(bible.secrets) ? bible.secrets.filter(isObj) : [],
      foreshadowing: Array.isArray(bible.foreshadowing) ? bible.foreshadowing.filter(isObj) : [],
      episodeNumber: outline.episodeNumber,
      userInstruction,
    });
  }
  /** A direct port of Python's generate_episode_script()'s inline prompt, generalized from a fixed "6" scene count to this Episode's own scene_count (see the "장면 수 가변화" work this session already did to the rest of this file), and with a narration output requirement added — the schema this now sends to callOpenAiStoryApi() requires narration on every scene, which Python's original prompt (written before Long Episode had narration) never mentioned. "Episode Wizard 수정값" is dropped from Python's priority list: Long Episode has no per-Episode Wizard concept to reference. */
  private buildScriptPrompt(context: Record<string, unknown>, sceneCount: number, clipDurationSeconds: number): string {
    return [
      "[1. 작업 목표]",
      "다음 장기 애니메이션에서 선택한 Episode 한 편의 상세 대본만 작성하십시오.",
      "",
      "[2. 설정 우선순위]",
      "Story Bible > 장기 프로젝트 전체 설정(project_overview) > Episode Outline > Continuity > 사용자 추가 지시사항",
      "설정이 충돌하면 앞쪽 설정을 우선하며 뒤쪽 입력으로 덮어쓰지 마십시오.",
      "",
      "[3. Episode 제작 Context]",
      JSON.stringify(context, null, 2),
      "",
      "[4. Asset 적용 규칙]",
      "candidate_assets는 Asset Library에서 가져온 이름·유형·설명의 텍스트 정보입니다. Story API에는 이미지가 첨부되지 않습니다.",
      "Asset의 핵심 특징을 대본 전체에서 일관되게 유지하십시오.",
      "",
      "[5. 출력 요구사항]",
      "이번 Episode만 작성하고 다른 Episode의 상세 대본은 생성하지 마십시오.",
      "공개 금지 정보를 노출하지 마십시오.",
      `정확히 ${sceneCount}개 장면을 지정된 JSON 형식으로만 반환하십시오.`,
      "각 장면에는 description과 함께 visual_action, start_motion, main_motion, end_motion, camera_motion, environment_motion, motion_speed, motion_intensity, expression_change, continuity_hint를 구체적인 현재형 문장으로 작성하십시오.",
      "대사 문장을 움직임으로 복사하지 말고 화면에 보이는 행동으로 변환하며, 다음 장면은 이전 장면의 end_motion을 자연스럽게 이어받게 하십시오.",
      `narration에는 장면당 ${clipDurationSeconds}초 안에 자연스럽게 읽을 수 있는 내레이션/자막 문장을 카메라 지시나 지문 없이 작성하십시오.`,
    ].join("\n");
  }
  private generated(outline: LongEpisodeOutline, bibleNames: string, continuity: Record<string, unknown>, sceneCount: number): LongEpisodeScript { const subject = outline.title || `Episode ${outline.episodeNumber}`; const latest = (continuity.recentContinuity as Array<{ summary: string }>).at(-1)?.summary; const scenes = Array.from({ length: sceneCount }, (_, index) => { const number = index + 1; return { number: number as SceneNumber, description: `${subject} scene ${number}: ${outline.summary || outline.mainEvent || "the episode progresses"}.`, visualAction: `The central action develops in scene ${number}.`, startMotion: "A still opening pose shifts into motion.", mainMotion: "The character advances the episode conflict.", endMotion: "The movement settles into the next scene.", shotSize: "medium shot", cameraAngle: "eye level", composition: "centered subject with readable background", lensFeel: "natural perspective", focusSubject: bibleNames || subject, cameraMotion: "gentle forward movement", environmentMotion: "subtle ambient movement", motionSpeed: "normal", motionIntensity: "moderate", expressionChange: "focused to hopeful", continuityHint: number === 1 && latest ? `Continue from prior Episode: ${latest}` : number === 1 ? "Establish the opening visual state." : "Continue the previous scene's ending pose and direction.", narration: `Scene ${number} narration for ${subject}.` }; }); return { title: `${subject} — Local Episode Script`, synopsis: `A local ${sceneCount}-scene draft for ${subject}.${latest ? ` It continues: ${latest}` : ""}`, ending: outline.cliffhanger || "The episode reaches its next turning point.", scenes }; }
  /**
   * The one Episode read that goes to disk for `narrationAvailable`.
   *
   * The merge screen decides which audio options to offer from this answer, so it has to be measured rather
   * than assumed. Responses that carry an Episode alongside something else leave the field absent instead of
   * reporting a `false` nobody checked.
   */
  async get(projectId: string, number: number): Promise<GetLongEpisodeResponse> {
    const id = projectId.trim();
    const outline = await this.outline(id, number);
    const stored = await this.stored(id, outline);
    const narrationAvailable = await this.narrationAvailable(id, number);
    // Read here rather than assumed by each screen: three of them were guessing "9:16" on their own, and the
    // one warning that matters — changing this leaves every already-paid-for image in the wrong shape — cannot
    // be raised on a guess. Filled only on this route, the same rule narrationAvailable follows.
    //
    // Soft: an Episode that reads perfectly must not become unreadable because the project file beside it does
    // not. This is one display field, and trading the whole Episode for it would be the worse answer.
    const aspectRatio = await this.projects.get(id).then((response) => response.project.settings.aspectRatio).catch(() => undefined);
    return { episode: { ...this.toApi(outline, stored), narrationAvailable, ...(aspectRatio ? { aspectRatio } : {}) } };
  }

  /** Real files, not a setting: the same "does audio exist on disk" meaning the short project's flag carries. */
  private async narrationAvailable(projectId: string, number: number): Promise<boolean> {
    const directory = path.join(this.files(projectId, number).episode, "narration");
    try {
      const entries = await fs.readdir(directory);
      const sizes = await Promise.all(entries.filter((name) => name.endsWith(".mp3")).map(async (name) => {
        try { return (await fs.stat(path.join(directory, name))).size; } catch { return 0; }
      }));
      return sizes.some((size) => size > 0);
    } catch {
      return false;
    }
  }
  /**
   * The Episode's own scene count and clip length.
   *
   * Lives on this service because this is what owns the stored Episode record — its read, its validation, its
   * write. A separate settings service would need a second copy of all three, and thirteen divergent copies of
   * exactly that kind of thing is what long-project-paths.ts exists to have ended (D-021).
   */
  async settings(projectId: string, number: number): Promise<GetLongEpisodeSettingsResponse> {
    const id = projectId.trim(); const outline = await this.outline(id, number); const stored = await this.stored(id, outline);
    const projectSettings = (await this.projects.get(id)).project.settings;
    return {
      settings: episodeSettings(stored.scene_count, stored.duration_seconds / stored.scene_count),
      projectDefaults: episodeSettings(projectSettings.sceneCount, projectSettings.clipDurationSeconds),
      changeable: !Object.keys(stored.script).length,
    };
  }

  async updateSettings(projectId: string, number: number, request: UpdateLongEpisodeSettingsRequest): Promise<UpdateLongEpisodeSettingsResponse> {
    const id = projectId.trim(); const outline = await this.outline(id, number); const stored = await this.stored(id, outline);
    if (!isObj(request) || Object.keys(request).length !== 2
      || !Number.isInteger(request.sceneCount) || Number(request.sceneCount) < MIN_SCENE_COUNT || Number(request.sceneCount) > MAX_SCENE_COUNT
      || !RUNWAY_CLIP_DURATIONS.includes(request.clipDurationSeconds as RunwayClipDurationSeconds)) {
      throw longInvalidRequest(`sceneCount must be an integer from ${MIN_SCENE_COUNT} to ${MAX_SCENE_COUNT} and clipDurationSeconds one of ${RUNWAY_CLIP_DURATIONS.join(", ")}.`);
    }
    // Refused once a script exists rather than silently leaving one written for other numbers. `changeable` on
    // the read says the same thing ahead of time, so a screen can disable the fields instead of failing here.
    if (Object.keys(stored.script).length) throw longEpisodeSettingsNotAllowed();

    stored.scene_count = request.sceneCount;
    stored.duration_seconds = request.sceneCount * request.clipDurationSeconds;
    stored.updated_at = new Date().toISOString();
    await this.save(id, outline, stored);
    return { settings: episodeSettings(stored.scene_count, request.clipDurationSeconds) };
  }

  /**
   * Writing this Episode's script, once per press.
   *
   * Under the project lock because the gate and the write sit on opposite sides of the provider call: the state
   * check and the "a script already exists" check both read values that only become true minutes later, at the
   * end. Two presses inside that window both pass and both are billed — measured on the Long Project outline,
   * which had the same shape, as two charges twenty-three seconds apart.
   *
   * Refused immediately rather than queued. A queued second press is worse than a refused one here: when it was
   * a regenerate it would run its own paid call after the first finished, and when it was not it would wait out
   * the whole generation only to be told a script already exists.
   */
  async generate(projectId: string, number: number, request: GenerateLongEpisodeScriptRequest): Promise<GenerateLongEpisodeScriptResponse> {
    const id = projectId.trim();
    try {
      return await withProjectLock(resolveSafeProjectDirectory(this.projectsRoot, id), `${id}:episode-${number}:script`,
        () => this.generateCore(id, number, request), { timeoutMs: 0 });
    } catch (error) {
      if (error instanceof ProjectLockTimeoutError) throw longLocked("Episode script generation");
      throw error;
    }
  }

  private async generateCore(projectId: string, number: number, request: GenerateLongEpisodeScriptRequest): Promise<GenerateLongEpisodeScriptResponse> {
    const id = projectId.trim(); const outline = await this.outline(id, number); const stored = await this.stored(id, outline);
    const userRequestId = isObj(request) && typeof request.userRequestId === "string" ? request.userRequestId.trim() : "";
    if (!userRequestId || userRequestId.length > 200) throw longInvalidRequest("Episode script generation requires a userRequestId.");
    // The same intent, arriving twice. Answer with what the first one made rather than making it again: a
    // regeneration is a legal repeat, so nothing else here would turn the second press away, and it costs money.
    if (stored.last_script_request_id === userRequestId && Object.keys(stored.script).length) {
      return { episode: this.toApi(outline, stored) };
    }
    if (!["outline_ready", "script_review", "script_approved"].includes(stored.state)) throw longEpisodeScriptNotAllowed();
    if (Object.keys(stored.script).length && request?.regenerate !== true) throw longEpisodeScriptExists();
    if (Object.keys(stored.script).length) stored.script_history.push({ created_at: new Date().toISOString(), source: "before_regeneration", script: stored.script });

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    let script: LongEpisodeScript; let historyEntry: Record<string, unknown>;
    if (apiKey && this.budget) {
      const context = await this.buildContext(id, outline, stored);
      const clipDurationSeconds = stored.duration_seconds / stored.scene_count;
      const prompt = this.buildScriptPrompt(context, stored.scene_count, clipDurationSeconds);
      try {
        await this.budget.preflight(STORY_ESTIMATED_COST_USD);
        let succeeded = false;
        try {
          const result = await callOpenAiStoryApi(apiKey, prompt, { sceneCount: stored.scene_count });
          script = this.parseScript(result.story, stored.scene_count);
          succeeded = true;
        } finally { await this.budget.record(id, "episode_story", succeeded, STORY_ESTIMATED_COST_USD); }
      } catch (error) {
        if (isBudgetLedgerUnreadable(error)) throw longBudgetLedgerUnreadable(); if (error instanceof OpenAiBudgetExceededError) throw longEpisodeScriptBudgetExceeded(error.message);
        if (error instanceof OpenAiAdapterError) throw longEpisodeScriptProviderError(error.category, error.message);
        throw longEpisodeScriptProviderError("unknown", OPENAI_KOREAN_MESSAGES.unknown);
      }
      historyEntry = { created_at: new Date().toISOString(), source: "openai_generation", script: this.storedScript(script!), context };
    } else {
      const continuity = await this.continuityContext(id, number);
      script = this.generated(outline, await this.bibleContext(id), continuity, stored.scene_count);
      historyEntry = { created_at: new Date().toISOString(), source: "local_fake_generation", script: this.storedScript(script), continuity_context: continuity };
    }
    stored.script = this.storedScript(script);
    stored.script_history.push(historyEntry);
    stored.script_revision += 1; stored.approved = false; stored.state = "script_review"; stored.updated_at = new Date().toISOString();
    stored.last_script_request_id = userRequestId;
    return { episode: await this.save(id, outline, stored) };
  }
  async update(projectId: string, number: number, request: UpdateLongEpisodeScriptRequest): Promise<UpdateLongEpisodeScriptResponse> { const id = projectId.trim(); const outline = await this.outline(id, number); const stored = await this.stored(id, outline); if (stored.state !== "script_review" || !Object.keys(stored.script).length) throw longEpisodeScriptNotAllowed(); const script = this.parseScript(request?.script, stored.scene_count, longInvalidRequest); stored.script_history.push({ created_at: new Date().toISOString(), source: "before_user_edit", script: stored.script }); stored.script = this.storedScript(script); stored.script_revision += 1; stored.approved = false; stored.updated_at = new Date().toISOString(); return { episode: await this.save(id, outline, stored) }; }
  async approve(projectId: string, number: number, request: ApproveLongEpisodeScriptRequest): Promise<ApproveLongEpisodeScriptResponse> { const id = projectId.trim(); const outline = await this.outline(id, number); const stored = await this.stored(id, outline); if (request?.approved !== true || stored.state !== "script_review" || !Object.keys(stored.script).length) throw longEpisodeScriptNotAllowed(); stored.approved = true; stored.state = "script_approved"; stored.updated_at = new Date().toISOString(); return { episode: await this.save(id, outline, stored) }; }
}
