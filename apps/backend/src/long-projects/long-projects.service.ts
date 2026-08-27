import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { LONG_OUTLINE_ESTIMATED_COST_USD, MAX_SCENE_COUNT, MIN_SCENE_COUNT, RUNWAY_CLIP_DURATIONS, type ApproveLongProjectOutlineRequest, type ApproveLongProjectOutlineResponse, type ArchivedLongProjectSummary, type ArchiveProjectRequest, type ArchiveProjectResponse, type CreateLongProjectOutlinePreviewResponse, type CreateLongProjectRequest, type CreateLongProjectResponse, type DeleteArchivedProjectRequest, type DeleteArchivedProjectResponse, type GetLongProjectResponse, type GetLongProjectSettingsResponse, type ListArchivedLongProjectsResponse, type ListLongProjectsResponse, type LongEpisodeOutline, type LongProject, type LongProjectSettings, type LongProjectSummary, type RestoreProjectResponse, type UpdateLongProjectSettingsRequest, type UpdateLongProjectSettingsResponse } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { archiveProjectDirectory, deleteArchivedProjectDirectory, listArchivedProjectDirectories, restoreProjectDirectory } from "../projects/project-archive.js";
import { isSafeProjectId } from "../projects/project-id.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError } from "../providers/openai-common.js";
import { callOpenAiEpisodePlannerApi, type OpenAiEpisodeOutlineResult } from "./openai-episode-planner-adapter.js";
import { longArchiveCollision, longArchiveNotAllowed, longExists, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longOutlineBudgetExceeded, longOutlineNotAllowed, longOutlineProviderError, longOutlineStale, longRestoreCollision, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { longStoryRoot } from "./long-project-paths.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";

const MAX_EPISODES = Number(process.env.APP_MAX_LONG_PROJECT_EPISODES ?? "60");
const settingKeys = ["title", "logline", "overview", "genre", "tone", "theme", "episodeCount", "sceneCount", "clipDurationSeconds", "aspectRatio", "audience", "notes", "startingState", "midpoint", "endingDirection", "storyFlowSummary", "narrationEnabled", "subtitlesEnabled"] as const;
type Stored = { project_id: string; project_type: "long_story_project"; title: string; logline: string; overview: string; genre: string; tone: string; theme: string; episode_count: number; scene_count: number; clip_duration_seconds: number; aspect_ratio: "9:16" | "16:9"; audience: string; notes: string; starting_state: string; midpoint: string; ending_direction: string; story_flow_summary: string; narration_enabled: boolean; subtitles_enabled: boolean; created_at: string; updated_at: string; outline_status: "planned" | "outline_ready"; outline_prompt_request?: { prompt_sha256: string; prompt: string; approved_at: string; modified: boolean }; };
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw longInvalidRequest(); return value as Record<string, unknown>; };
const text = (value: unknown, required = false): string => { if (typeof value !== "string") throw longInvalidRequest(); const result = value.trim(); if (required && !result) throw longInvalidRequest(); return result; };
const isValidSceneCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= MIN_SCENE_COUNT && value <= MAX_SCENE_COUNT;
const isValidClipDuration = (value: unknown): value is number => typeof value === "number" && (RUNWAY_CLIP_DURATIONS as readonly number[]).includes(value);
/**
 * A project stored before sceneCount/clipDurationSeconds existed has neither field — only the older
 * episode_duration_seconds (itself once a free-form number, later constrained to 30/60). Coerces to the nearest
 * sensible reading (6 scenes, matching Episodes that were always six back then) rather than rejecting the whole
 * project — same reasoning as episode-videos.service.ts's durationSecondsPerScene() coercion.
 */
function coerceSceneCountAndClipDuration(stored: Record<string, unknown>): { sceneCount: number; clipDurationSeconds: number } {
  if (isValidSceneCount(stored.scene_count) && isValidClipDuration(stored.clip_duration_seconds)) return { sceneCount: stored.scene_count, clipDurationSeconds: stored.clip_duration_seconds };
  const legacyDurationSeconds = typeof stored.episode_duration_seconds === "number" ? stored.episode_duration_seconds : 30;
  return { sceneCount: 6, clipDurationSeconds: legacyDurationSeconds >= 45 ? 10 : 5 };
}
/**
 * A project stored before narrationEnabled/subtitlesEnabled existed has neither field. Same fallback as
 * ShortProjectSettings.subtitlesEnabled (project-settings.ts's toShortProjectSettings): subtitlesEnabled falls
 * back to narrationEnabled's own value when the key was never stored, so an existing narration-enabled project
 * keeps exactly its current (silent) merged output instead of silently losing subtitles the first time this is
 * read, rather than defaulting to false outright.
 */
function coerceNarrationSettings(stored: Record<string, unknown>): { narrationEnabled: boolean; subtitlesEnabled: boolean } {
  const narrationEnabled = stored.narration_enabled === true;
  const subtitlesEnabled = "subtitles_enabled" in stored ? stored.subtitles_enabled === true : narrationEnabled;
  return { narrationEnabled, subtitlesEnabled };
}
function settings(value: unknown): LongProjectSettings {
  const data = object(value);
  if (Object.keys(data).some((key) => !settingKeys.includes(key as typeof settingKeys[number]))) throw longInvalidRequest("Unknown long-project setting.");
  const title = text(data.title, true); const logline = text(data.logline, true);
  const episodeCount = data.episodeCount;
  if (!Number.isInteger(episodeCount) || (episodeCount as number) < 1 || (episodeCount as number) > MAX_EPISODES) throw longInvalidRequest();
  if (!isValidSceneCount(data.sceneCount)) throw longInvalidRequest(`settings.sceneCount must be an integer between ${MIN_SCENE_COUNT} and ${MAX_SCENE_COUNT}.`);
  if (!isValidClipDuration(data.clipDurationSeconds)) throw longInvalidRequest(`settings.clipDurationSeconds must be one of: ${RUNWAY_CLIP_DURATIONS.join(", ")}.`);
  if (data.aspectRatio !== "9:16" && data.aspectRatio !== "16:9") throw longInvalidRequest();
  if (typeof data.narrationEnabled !== "boolean") throw longInvalidRequest("settings.narrationEnabled must be a boolean.");
  if (typeof data.subtitlesEnabled !== "boolean") throw longInvalidRequest("settings.subtitlesEnabled must be a boolean.");
  return {
    title, logline, overview: text(data.overview), genre: text(data.genre), tone: text(data.tone), theme: text(data.theme),
    episodeCount: episodeCount as number,
    // Derived, not accepted from the client — see LongProjectSettings.episodeDurationSeconds's doc comment.
    episodeDurationSeconds: data.sceneCount * data.clipDurationSeconds,
    sceneCount: data.sceneCount, clipDurationSeconds: data.clipDurationSeconds,
    aspectRatio: data.aspectRatio,
    audience: text(data.audience), notes: text(data.notes), startingState: text(data.startingState), midpoint: text(data.midpoint), endingDirection: text(data.endingDirection), storyFlowSummary: text(data.storyFlowSummary),
    narrationEnabled: data.narrationEnabled, subtitlesEnabled: data.subtitlesEnabled,
  };
}
function toSettings(s: Stored): LongProjectSettings { return { title: s.title, logline: s.logline, overview: s.overview, genre: s.genre, tone: s.tone, theme: s.theme, episodeCount: s.episode_count, episodeDurationSeconds: s.scene_count * s.clip_duration_seconds, sceneCount: s.scene_count, clipDurationSeconds: s.clip_duration_seconds, aspectRatio: s.aspect_ratio, audience: s.audience, notes: s.notes, startingState: s.starting_state, midpoint: s.midpoint, endingDirection: s.ending_direction, storyFlowSummary: s.story_flow_summary, narrationEnabled: s.narration_enabled, subtitlesEnabled: s.subtitles_enabled }; }
function setStored(id: string, s: LongProjectSettings, now: string, createdAt = now, status: Stored["outline_status"] = "planned"): Stored { return { project_id: id, project_type: "long_story_project", title: s.title, logline: s.logline, overview: s.overview, genre: s.genre, tone: s.tone, theme: s.theme, episode_count: s.episodeCount, scene_count: s.sceneCount, clip_duration_seconds: s.clipDurationSeconds, aspect_ratio: s.aspectRatio, audience: s.audience, notes: s.notes, starting_state: s.startingState, midpoint: s.midpoint, ending_direction: s.endingDirection, story_flow_summary: s.storyFlowSummary, narration_enabled: s.narrationEnabled, subtitles_enabled: s.subtitlesEnabled, created_at: createdAt, updated_at: now, outline_status: status }; }
function summary(s: Stored): LongProjectSummary { return { id: s.project_id, title: s.title, logline: s.logline, episodeCount: s.episode_count, outlineStatus: s.outline_status, createdAt: s.created_at, updatedAt: s.updated_at }; }

@Injectable()
export class LongProjectsService {
  constructor(
    private readonly projectsRoot: string,
    private readonly archiveDirectory: (projectsRoot: string, projectId: string) => Promise<void> = archiveProjectDirectory,
    private readonly restoreDirectory: (projectsRoot: string, projectId: string) => Promise<void> = restoreProjectDirectory,
    private readonly deleteArchivedDirectory: (projectsRoot: string, projectId: string) => Promise<void> = deleteArchivedProjectDirectory,
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
  ) {}
  private root(id: string): string { return longStoryRoot(this.projectsRoot, id); }
  private files(id: string) { const root = this.root(id); return { root, project: path.join(root, "project.json"), bible: path.join(root, "story_bible.json"), outlines: path.join(root, "episode_outlines.json") }; }
  private archiveRoot(id: string): string { return longStoryRoot(path.resolve(this.projectsRoot, ".archive"), id); }
  private archiveFile(id: string): string { return path.join(this.archiveRoot(id), "project.json"); }
  private async loadArchived(id: string): Promise<Stored> { const stored = this.parseStored(await this.readJson(this.archiveFile(id))); if (stored.project_id !== id) throw longInvalidData(); return stored; }
  private async readJson(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  // "platform" stays accepted (and silently discarded) here even though it is no longer part of Stored/settings():
  // every project.json written before its removal still has the key, and rejecting an unknown key would make
  // every existing long project fail to load.
  private parseStored(value: unknown): Stored { const d = object(value); const known = new Set(["project_id", "project_type", "title", "logline", "overview", "genre", "tone", "theme", "episode_count", "episode_duration_seconds", "scene_count", "clip_duration_seconds", "platform", "aspect_ratio", "audience", "notes", "starting_state", "midpoint", "ending_direction", "story_flow_summary", "narration_enabled", "subtitles_enabled", "created_at", "updated_at", "outline_status", "outline_prompt_request"]); if (Object.keys(d).some((key) => !known.has(key))) throw longInvalidData(); try { const { sceneCount, clipDurationSeconds } = coerceSceneCountAndClipDuration(d); const { narrationEnabled, subtitlesEnabled } = coerceNarrationSettings(d); const result = setStored(text(d.project_id, true), settings({ title: d.title, logline: d.logline, overview: d.overview, genre: d.genre, tone: d.tone, theme: d.theme, episodeCount: d.episode_count, sceneCount, clipDurationSeconds, aspectRatio: d.aspect_ratio, audience: d.audience, notes: d.notes, startingState: d.starting_state, midpoint: d.midpoint, endingDirection: d.ending_direction, storyFlowSummary: d.story_flow_summary, narrationEnabled, subtitlesEnabled }), text(d.updated_at, true), text(d.created_at, true), d.outline_status === "outline_ready" ? "outline_ready" : d.outline_status === "planned" ? "planned" : (() => { throw longInvalidData(); })()); if (d.project_type !== "long_story_project") throw longInvalidData(); if (d.outline_prompt_request !== undefined) result.outline_prompt_request = d.outline_prompt_request as Stored["outline_prompt_request"]; return result; } catch (error) { if (error instanceof Error && "getStatus" in error) throw error; throw longInvalidData(); } }
  private async load(id: string): Promise<Stored> { const stored = this.parseStored(await this.readJson(this.files(id).project)); if (stored.project_id !== id) throw longInvalidData(); return stored; }
  private async outlines(id: string, count: number): Promise<LongEpisodeOutline[]> { const raw = await this.readJson(this.files(id).outlines); if (!Array.isArray(raw) || raw.length !== count) throw longInvalidData(); return raw.map((item, index) => { const d = object(item); if (d.episode_number !== index + 1 || typeof d.title !== "string" || typeof d.summary !== "string" || typeof d.main_event !== "string" || typeof d.conflict !== "string" || typeof d.cliffhanger !== "string" || typeof d.next_episode_hook !== "string" || !["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed", "failed"].includes(d.status as string)) throw longInvalidData(); const warnings = withoutStaleEpisodeRecoveryWarnings(Array.isArray(d.warnings) ? d.warnings.filter((entry): entry is string => typeof entry === "string") : [], d.status as string); return { episodeNumber: index + 1, title: d.title, summary: d.summary, mainEvent: d.main_event, conflict: d.conflict, cliffhanger: d.cliffhanger, nextEpisodeHook: d.next_episode_hook, status: d.status as LongEpisodeOutline["status"], ...(warnings.length > 0 ? { warnings } : {}) }; }); }
  private async project(id: string): Promise<LongProject> { const s = await this.load(id); const bible = object(await this.readJson(this.files(id).bible)); const basic = object(bible.basic); const world = object(bible.world); return { ...summary(s), settings: toSettings(s), storyBible: { basic, world }, episodes: await this.outlines(id, s.episode_count) }; }
  async create(request: CreateLongProjectRequest): Promise<CreateLongProjectResponse> { const id = text(request?.projectId, true); if (!isSafeProjectId(id)) throw longUnsafeId(); const input = settings(request?.settings); const now = new Date().toISOString(); const stored = setStored(id, input, now); const files = this.files(id); try { await fs.mkdir(files.root, { recursive: false }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { try { await fs.mkdir(path.dirname(files.root), { recursive: true }); await fs.mkdir(files.root); } catch (nested) { if ((nested as NodeJS.ErrnoException).code === "EEXIST") throw longExists(); throw longStorageError(); } } else if ((error as NodeJS.ErrnoException).code === "EEXIST") throw longExists(); else throw longStorageError(); } try { await Promise.all([atomicWriteUtf8File(files.project, JSON.stringify(stored, null, 2)), atomicWriteUtf8File(files.bible, JSON.stringify({ basic: { title: input.title, logline: input.logline, overview: input.overview, genre: input.genre, tone: input.tone, theme: input.theme, ending_direction: input.endingDirection, audience: input.audience }, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], summaries: {}, updated_at: now }, null, 2)), atomicWriteUtf8File(files.outlines, JSON.stringify(Array.from({ length: input.episodeCount }, (_, i) => ({ episode_number: i + 1, title: `Episode ${i + 1}`, summary: "", main_event: "", conflict: "", cliffhanger: "", next_episode_hook: "", status: "planned" })), null, 2))]); } catch { throw longStorageError(); } return { project: await this.project(id) }; }
  async list(): Promise<ListLongProjectsResponse> { let entries: string[]; try { entries = (await fs.readdir(this.projectsRoot, { withFileTypes: true })).filter((x) => x.isDirectory() && isSafeProjectId(x.name)).map((x) => x.name); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { projects: [] }; throw longStorageError(); } const projects: LongProjectSummary[] = []; for (const id of entries) { try { projects.push(summary(await this.load(id))); } catch { /* Python catalog skips unreadable entries. */ } } return { projects: projects.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) }; }
  async get(id: string): Promise<GetLongProjectResponse> { return { project: await this.project(id.trim()) }; }
  async archive(id: string, request: ArchiveProjectRequest): Promise<ArchiveProjectResponse> {
    const projectId = typeof id === "string" ? id.trim() : "";
    const stored = await this.load(projectId);
    if (!request || Object.keys(request).length !== 1 || typeof request.confirmation !== "string" || !request.confirmation.trim() || request.confirmation !== stored.title) throw longInvalidRequest("Archive confirmation must exactly match the long-project title.");
    const outlines = await this.outlines(projectId, stored.episode_count);
    if (outlines.some((episode) => ["generating_images", "videos_generating", "rendering", "interrupted"].includes(episode.status))) throw longArchiveNotAllowed();
    try { await this.archiveDirectory(this.projectsRoot, projectId); }
    catch (error) { if (error instanceof Error && error.message === "archive destination already exists") throw longArchiveCollision(); throw longStorageError(); }
    return { archivedProjectId: projectId };
  }
  async listArchived(): Promise<ListArchivedLongProjectsResponse> {
    const entries = await listArchivedProjectDirectories(this.projectsRoot);
    const results: ArchivedLongProjectSummary[] = [];
    for (const entry of entries) {
      try { results.push({ ...summary(await this.loadArchived(entry.projectId)), archivedAt: entry.archivedAt }); }
      catch { /* Python catalog skips unreadable entries. */ }
    }
    return { projects: results.sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt)) };
  }
  async restore(id: string): Promise<RestoreProjectResponse> {
    const projectId = typeof id === "string" ? id.trim() : "";
    try { await this.restoreDirectory(this.projectsRoot, projectId); }
    catch (error) {
      if (error instanceof Error && error.message === "archived project not found") throw longNotFound();
      if (error instanceof Error && error.message === "restore destination already exists") throw longRestoreCollision();
      if (error && typeof error === "object" && "getStatus" in error) throw error;
      throw longStorageError();
    }
    return { restoredProjectId: projectId };
  }
  async deleteArchived(id: string, request: DeleteArchivedProjectRequest): Promise<DeleteArchivedProjectResponse> {
    const projectId = typeof id === "string" ? id.trim() : "";
    const stored = await this.loadArchived(projectId);
    if (!request || Object.keys(request).length !== 1 || typeof request.confirmation !== "string" || !request.confirmation.trim() || request.confirmation !== stored.title) throw longInvalidRequest("Delete confirmation must exactly match the long-project title.");
    try { await this.deleteArchivedDirectory(this.projectsRoot, projectId); }
    catch (error) { if (error && typeof error === "object" && "getStatus" in error) throw error; throw longStorageError(); }
    return { deletedProjectId: projectId };
  }
  async getSettings(id: string): Promise<GetLongProjectSettingsResponse> { return { settings: toSettings(await this.load(id.trim())) }; }
  async updateSettings(id: string, request: UpdateLongProjectSettingsRequest): Promise<UpdateLongProjectSettingsResponse> { const prior = await this.load(id.trim()); const updated = setStored(prior.project_id, settings(request?.settings), new Date().toISOString(), prior.created_at, prior.outline_status); updated.outline_prompt_request = prior.outline_prompt_request; try { await atomicWriteUtf8File(this.files(prior.project_id).project, JSON.stringify(updated, null, 2)); } catch { throw longStorageError(); } return { project: await this.project(prior.project_id) }; }
  /** A direct port of Python's render_project_outline_prompt() — the exact prompt the real planner adapter (when connected) is sent, and the text a user reviews/edits before approval either way. */
  private async renderOutlinePrompt(s: Stored): Promise<string> {
    const bible = object(await this.readJson(this.files(s.project_id).bible));
    const { updated_at: _updatedAt, ...bibleForPrompt } = bible;
    const projectPayload = {
      "작품 제목": s.title,
      "한 줄 주제": s.logline || "자율",
      "세계관·전체 줄거리": s.overview || "자율",
      "장르": s.genre || "자율",
      "전체 분위기": s.tone || "자율",
      "핵심 주제": s.theme || "자율",
      "시작 상태": s.starting_state || "자율",
      "중간 전환점": s.midpoint || "자율",
      "결말 방향": s.ending_direction || "자율",
      "전체 이야기 흐름": s.story_flow_summary || "자율",
      "대상 시청자": s.audience || "자율",
      "추가 지시사항": s.notes || "없음",
      "총 Episode 수": s.episode_count,
      "Episode당 길이(초)": s.scene_count * s.clip_duration_seconds,
    };
    return [
      "[1. 작업 목표]",
      "장기 애니메이션의 전체 작품 개요와 모든 Episode Outline을 한 번에 작성하십시오.",
      "",
      "[2. 작품 전체 설정]",
      JSON.stringify(projectPayload, null, 2),
      "",
      "[3. Story Bible]",
      JSON.stringify(bibleForPrompt, null, 2),
      "",
      "[4. 출력 요구사항]",
      `Episode를 정확히 ${s.episode_count}개 작성하십시오.`,
      "전체 작품 개요와 각 Episode의 제목, 요약, 핵심 사건, 갈등, 클리프행어, 다음 Episode 연결을 서로 모순 없이 구성하십시오.",
      "장면별 상세 대본, 이미지 프롬프트, 이미지, Reference 선택, 영상 생성 데이터는 생성하지 마십시오.",
    ].join("\n");
  }
  async preview(id: string): Promise<CreateLongProjectOutlinePreviewResponse> {
    const s = await this.load(id.trim());
    const prompt = await this.renderOutlinePrompt(s);
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    // Read-only, same as every other preview's budget field — never reserves anything, just reports the ledger's current state.
    const outlineBudget = apiKey && this.budget ? await budgetPreviewFor(this.budget, LONG_OUTLINE_ESTIMATED_COST_USD) : undefined;
    return { preview: { projectId: s.project_id, prompt, promptSha256: crypto.createHash("sha256").update(prompt, "utf8").digest("hex"), episodeCount: s.episode_count }, ...(outlineBudget ? { budget: outlineBudget } : {}) };
  }
  /** Applies the real adapter's response the same way Python's generate_project_outline() does: user-entered project fields are authoritative and only filled in when blank, never overwritten. */
  private applyOutlineResult(s: Stored, result: OpenAiEpisodeOutlineResult): { project: Record<string, unknown>; episodes: Array<Record<string, unknown>> } {
    const numbers = result.episodes.map((item) => item.episode_number).sort((a, b) => a - b);
    if (numbers.length !== s.episode_count || numbers.some((value, index) => value !== index + 1)) throw new OpenAiAdapterError("invalid_response", "Episode 개요 번호가 연속적이지 않습니다.");
    const projectFields = ["title", "logline", "overview", "genre", "tone", "theme", "starting_state", "midpoint", "ending_direction", "story_flow_summary"] as const;
    const project: Record<string, unknown> = {};
    for (const field of projectFields) project[field] = s[field]?.toString().trim() ? s[field] : result.project[field];
    const byNumber = new Map(result.episodes.map((item) => [item.episode_number, item]));
    const episodes = Array.from({ length: s.episode_count }, (_, index) => {
      const item = byNumber.get(index + 1)!;
      return { episode_number: index + 1, title: item.title, summary: item.summary, main_event: item.main_event, conflict: item.conflict, cliffhanger: item.cliffhanger, next_episode_hook: item.next_episode_hook, status: "outline_ready" as const };
    });
    return { project, episodes };
  }
  async approve(id: string, request: ApproveLongProjectOutlineRequest): Promise<ApproveLongProjectOutlineResponse> {
    const s = await this.load(id.trim()); if (s.outline_status !== "planned") throw longOutlineNotAllowed();
    const preview = await this.preview(s.project_id);
    if (!(request && request.approved === true && typeof request.prompt === "string" && request.prompt.trim() && request.promptSha256 === preview.preview.promptSha256)) throw longOutlineStale();
    const modified = request.prompt !== preview.preview.prompt;
    const now = new Date().toISOString();
    s.outline_prompt_request = { prompt_sha256: crypto.createHash("sha256").update(request.prompt, "utf8").digest("hex"), prompt: request.prompt, approved_at: now, modified };

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    let generated: Array<Record<string, unknown>>;
    if (apiKey && this.budget) {
      try {
        await this.budget.preflight(LONG_OUTLINE_ESTIMATED_COST_USD);
        let succeeded = false;
        let result: OpenAiEpisodeOutlineResult;
        try {
          result = (await callOpenAiEpisodePlannerApi(apiKey, request.prompt, s.episode_count)).result;
          succeeded = true;
        } finally { await this.budget.record(s.project_id, "long_story_outline", succeeded, LONG_OUTLINE_ESTIMATED_COST_USD); }
        const applied = this.applyOutlineResult(s, result);
        for (const [field, value] of Object.entries(applied.project)) (s as Record<string, unknown>)[field] = value;
        generated = applied.episodes;
      } catch (error) {
        if (error instanceof OpenAiBudgetExceededError) throw longOutlineBudgetExceeded(error.message);
        if (error instanceof OpenAiAdapterError) throw longOutlineProviderError(error.category, error.message);
        // Any other failure (a bug, an unclassified network edge case) must still land as a coded ApiError —
        // an uncaught rethrow here would surface as a bare 500 with no `code`, which the frontend can only
        // show as its most generic client-side fallback instead of this screen's own provider-error message.
        throw longOutlineProviderError("unknown", OPENAI_KOREAN_MESSAGES.unknown);
      }
    } else {
      // Local-fake fallback: only used when no OpenAI credential is connected. Fills every field that render
      // never blanked out (never generates blank ones — see the fields loop below).
      const fields = ["overview", "genre", "tone", "theme", "starting_state", "midpoint", "ending_direction", "story_flow_summary"] as const;
      for (const field of fields) if (!s[field]) s[field] = `${s.title} ${field.replaceAll("_", " ")}`;
      generated = Array.from({ length: s.episode_count }, (_, i) => ({ episode_number: i + 1, title: `Episode ${i + 1}: ${s.title}`, summary: `${s.logline} — episode ${i + 1}`, main_event: `Episode ${i + 1} main event`, conflict: "Unresolved conflict", cliffhanger: i + 1 === s.episode_count ? "Story conclusion approaches" : `Continue to episode ${i + 2}`, next_episode_hook: i + 1 === s.episode_count ? "" : `Episode ${i + 2}`, status: "outline_ready" }));
    }

    s.outline_status = "outline_ready"; s.updated_at = now;
    try { await atomicWriteUtf8File(this.files(s.project_id).project, JSON.stringify(s, null, 2)); await atomicWriteUtf8File(this.files(s.project_id).outlines, JSON.stringify(generated, null, 2)); } catch { throw longStorageError(); }
    return { project: await this.project(s.project_id), approvedAt: now, promptSha256: s.outline_prompt_request.prompt_sha256, modified };
  }
}
