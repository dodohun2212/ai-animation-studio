import * as crypto from "node:crypto";
import { storedSceneCount } from "../projects/stored-scene-count.js";
import { assertEpisodeListed, readLongProjectJson } from "./long-project-json.js";
import { OPENAI_LEDGER_FILE, recordSpend, spendUnrecordedWarning } from "../providers/budget-ledger.js";
import { persistEpisodeWarning } from "./episode-warnings.js";
import { isBudgetLedgerUnreadable } from "../providers/budget-ledger.js";
import { PLACEHOLDER_ADAPTER, PLACEHOLDER_MP3 } from "../narration/placeholder-narration.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { LONG_EPISODE_STATUSES, sceneNumbersFor, TTS_ESTIMATED_COST_USD, type GetLongEpisodeNarrationReviewResponse, type LongEpisodeDetail, type LongEpisodeNarrationReview, type LongEpisodeNarrationStaleness,
  type NarrationAudioState, type LongEpisodeStatus, type RegenerateLongEpisodeNarrationResponse, type SceneNumber, type StartLongEpisodeNarrationGenerationRequest, type StartLongEpisodeNarrationGenerationResponse } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { resolveSafeProjectDirectory } from "../projects/project-id.js";
import { ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError } from "../providers/openai-common.js";
import { OPENAI_TTS_MODEL, callOpenAiTtsApi } from "../narration/openai-narration-adapter.js";
import { probeAudioDurationSeconds } from "../narration/audio-duration.js";
import { longBudgetLedgerUnreadable, longEpisodeNarrationBudgetExceeded, longEpisodeNarrationContentUnavailable, longEpisodeNarrationGenerationFailed, longEpisodeNarrationMissingText, longEpisodeNarrationNotAllowed, longEpisodeNarrationNotEnabled, longEpisodeNarrationProviderError, longEpisodeNarrationStorageError, longEpisodeNotFound, longInvalidData, longLocked, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { toEpisodeDetail } from "./episode-detail.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";
import { LongProjectsService } from "./long-projects.service.js";

const statuses: readonly LongEpisodeStatus[] = LONG_EPISODE_STATUSES;
type StoredEpisode = Record<string, unknown> & { number: number; state: LongEpisodeStatus; approved: boolean; script: Record<string, unknown>; script_revision: number; updated_at: string; scene_count?: number };
type StoredRecord = { scene_number: SceneNumber; narration: string; checkpoint: "completed"; adapter: string; tts_api_calls: number; regenerated?: true };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

@Injectable()
export class EpisodeNarrationService {
  private readonly projects: LongProjectsService;
  constructor(
    private readonly projectsRoot: string,
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
  ) { this.projects = new LongProjectsService(projectsRoot); }

  private files(projectId: string, number: number) {
    const root = longStoryRoot(this.projectsRoot, projectId);
    const episode = path.join(root, episodeDirectoryName(number));
    return { root, outlines: path.join(root, "episode_outlines.json"), episode, project: path.join(episode, "project.json"), narration: path.join(episode, "narration"), records: path.join(episode, "narration_generation_records.json") };
  }
  private async episode(projectId: string, number: number): Promise<StoredEpisode> {
    const files = this.files(projectId, number);
    await assertEpisodeListed(files.outlines, number);
    // Unlike the other Episode services, narration can legitimately be asked about before the Episode has ever
    // been touched by episode-scripts.service.ts (no state gate — see the shared contract's doc comment), so
    // its per-episode project.json file may not exist on disk yet at all. That is simply "no script yet", not a
    // storage error.
    let raw: unknown;
    try { raw = await readLongProjectJson(files.project); }
    catch (error) { if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) throw longEpisodeNarrationNotAllowed(); throw error; }
    if (!object(raw) || raw.number !== number || !statuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !object(raw.script) || !Number.isInteger(raw.script_revision) || typeof raw.updated_at !== "string") throw longInvalidData();
    return raw as StoredEpisode;
  }
  /** Falls back to 6, matching every Episode stored before scene_count existed (see episode-scripts.service.ts's parseStored). */
  private sceneCount(episode: StoredEpisode): number { return storedSceneCount(episode); }
  private detail(episode: StoredEpisode): LongEpisodeDetail { return toEpisodeDetail(episode); }
  /** Not gated by LongEpisodeStatus (see the shared contract's doc comment on this feature) — the only requirement is that a script exists at all, since there is nothing to narrate before then. */
  private assertHasScript(episode: StoredEpisode): void { if (!Object.keys(episode.script).length) throw longEpisodeNarrationNotAllowed(); }
  /** Raw stored scene objects (snake_case fields; "narration" is spelled the same both cased). */
  private scriptScenes(episode: StoredEpisode, sceneCount: number): Record<string, unknown>[] {
    const scenes = episode.script.scenes;
    if (!Array.isArray(scenes) || scenes.length !== sceneCount) throw longInvalidData();
    return scenes.map((item) => object(item) ? item : {});
  }
  private sceneNarrationText(scene: Record<string, unknown>): string { return typeof scene.narration === "string" ? scene.narration.trim() : ""; }

  narrationPath(projectId: string, number: number, scene: SceneNumber): string { return path.join(this.files(projectId, number).narration, `scene${scene}.mp3`); }
  private async validAudio(file: string): Promise<boolean> { try { return (await fs.stat(file)).size > 0; } catch { return false; } }
  private async writeAudio(file: string, bytes: Buffer): Promise<void> {
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`); let renamed = false;
    try { await fs.writeFile(temp, bytes); await fs.rename(temp, file); renamed = true; } finally { if (!renamed) await fs.unlink(temp).catch(() => undefined); }
  }
  /**
   * Whether the audio already on disk is still the audio this scene should have.
   *
   * The check used to be "is there a file", which is a different question and answered yes in two cases where
   * the file was wrong:
   *
   * - A placeholder written with no credential passed as real audio forever. Connect a TTS key afterwards and
   *   every one of those scenes was skipped as already done, so the narration could never become real — no
   *   error, no cost, and the app reporting audio the whole time.
   * - Reword a scene's narration and the old audio stayed. Pressing generate did nothing, and the video kept
   *   saying the previous line.
   *
   * Both are the same mistake: asking about the file's existence rather than about what is in it. The record is
   * what knows, and it has been written all along.
   */
  /**
   * What the audio on disk is, not merely whether it is there.
   *
   * The record is the only thing that knows a placeholder is a placeholder — the file is a valid MP3 header and
   * passes every check that asks about existence. Saying so is what lets a screen stop calling four bytes of
   * silence "음성 있음", and what lets the merge stop putting it into a finished video.
   *
   * A file with no record is reported as generated rather than placeholder: this service did not write it, so
   * calling it a placeholder would be a claim about something it knows nothing about.
   */
  private async audioState(records: readonly StoredRecord[], sceneNumber: SceneNumber, file: string): Promise<NarrationAudioState> {
    if (!(await this.validAudio(file))) return "none";
    return records.find((item) => item.scene_number === sceneNumber)?.adapter === PLACEHOLDER_ADAPTER ? "placeholder" : "generated";
  }

  private stillGoodAudio(records: readonly StoredRecord[], sceneNumber: SceneNumber, text: string, canUseRealTts: boolean): boolean {
    const record = records.find((item) => item.scene_number === sceneNumber);
    // No record at all: something put a file there that this service did not write. Regenerate rather than trust it.
    if (!record || record.narration !== text) return false;
    // A placeholder is only worth keeping while it is still the best this app can do.
    return record.adapter !== PLACEHOLDER_ADAPTER || !canUseRealTts;
  }

  private async loadRecords(projectId: string, number: number): Promise<StoredRecord[]> {
    try {
      const raw = await readLongProjectJson(this.files(projectId, number).records);
      if (!Array.isArray(raw)) throw longInvalidData();
      return raw.map((item) => { if (!object(item) || !Number.isInteger(item.scene_number) || typeof item.narration !== "string" || item.checkpoint !== "completed" || typeof item.adapter !== "string" || !Number.isInteger(item.tts_api_calls)) throw longInvalidData(); return item as StoredRecord; });
    } catch (error) { if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) return []; throw error; }
  }
  private async saveRecords(projectId: string, number: number, records: StoredRecord[]): Promise<void> { try { await atomicWriteUtf8File(this.files(projectId, number).records, JSON.stringify(records, null, 2)); } catch { throw longStorageError(); } }
  private async putRecord(projectId: string, number: number, record: StoredRecord): Promise<void> {
    const records = (await this.loadRecords(projectId, number)).filter((item) => item.scene_number !== record.scene_number);
    records.push(record);
    await this.saveRecords(projectId, number, records.sort((a, b) => a.scene_number - b.scene_number));
  }

  private async toApiNarrations(projectId: string, number: number, scenes: readonly Record<string, unknown>[]): Promise<LongEpisodeNarrationReview[]> {
    const records = await this.loadRecords(projectId, number);
    return Promise.all(scenes.map(async (scene, index) => {
      const sceneNumber = (index + 1) as SceneNumber;
      const narration = this.sceneNarrationText(scene);
      const file = this.narrationPath(projectId, number, sceneNumber);
      const audio = await this.audioState(records, sceneNumber, file);
      const audioDurationSeconds = audio === "none" ? undefined : await probeAudioDurationSeconds(file);
      return { sceneNumber, narration, audio, ...(audioDurationSeconds !== undefined ? { audioDurationSeconds } : {}) };
    }));
  }

  /**
   * Which spoken scenes no longer match the words the script now has.
   *
   * The comparison already existed — `stillGoodAudio` makes it to decide whether a generation must re-buy a
   * scene — and its answer never reached the screen. So the app knew the audio said something the script no
   * longer does, and the review screen still offered it for approval.
   *
   * A scene with no record is absent rather than listed: nothing has been spoken, so nothing is behind. And a
   * scene whose audio is gone from disk is left out too — that is "not made", which the review's own `state`
   * says, and calling it stale would send someone to re-buy what they have not bought once.
   */
  private async narrationStaleness(id: string, number: number, scenes: readonly Record<string, unknown>[]): Promise<LongEpisodeNarrationStaleness> {
    const records = await this.loadRecords(id, number);
    const narrationStale: SceneNumber[] = [];
    for (const sceneNumber of sceneNumbersFor(scenes.length)) {
      const scene = scenes[sceneNumber - 1];
      const record = records.find((item) => item.scene_number === sceneNumber);
      if (!scene || !record) continue;
      if (!(await this.validAudio(this.narrationPath(id, number, sceneNumber)))) continue;
      if (record.narration !== this.sceneNarrationText(scene)) narrationStale.push(sceneNumber);
    }
    return { narrationStale };
  }

  async get(projectId: string, number: number): Promise<GetLongEpisodeNarrationReviewResponse> {
    const id = projectId.trim(); const episode = await this.episode(id, number); this.assertHasScript(episode);
    const scenes = this.scriptScenes(episode, this.sceneCount(episode));
    const narrations = await this.toApiNarrations(id, number, scenes);
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, TTS_ESTIMATED_COST_USD) : undefined;
    return { episode: this.detail(episode), narrations, staleness: await this.narrationStaleness(id, number, scenes), ...(budget ? { budget } : {}) };
  }

  /**
   * Speaking every scene's narration that does not already have good audio.
   *
   * The one guarded step with nothing else standing in for it. The others gate on a stored state — images write
   * `generating_images` before their first call, so a second arrival is refused by the state machine — but
   * narration is not part of the Episode state machine and writes no in-progress marker of its own. Its
   * per-scene reuse check is no substitute: two presses that arrive together both read scene 1 as missing,
   * because neither has written it yet. Overlapping presses were billed once per scene, not once.
   *
   * Refused immediately rather than queued: a queued second press would re-walk every scene, find the audio the
   * first one wrote, and reuse all of it — the right answer, arrived at after making the caller wait out an
   * entire generation to be told nothing happened.
   */
  async generate(projectId: string, number: number, request: StartLongEpisodeNarrationGenerationRequest): Promise<StartLongEpisodeNarrationGenerationResponse> {
    const locked = projectId.trim();
    try {
      return await withProjectLock(resolveSafeProjectDirectory(this.projectsRoot, locked), `${locked}:episode-${number}:narration`,
        () => this.generateCore(projectId, number, request), { timeoutMs: 0 });
    } catch (error) {
      if (error instanceof ProjectLockTimeoutError) throw longLocked("Episode narration generation");
      throw error;
    }
  }

  private async generateCore(projectId: string, number: number, request: StartLongEpisodeNarrationGenerationRequest): Promise<StartLongEpisodeNarrationGenerationResponse> {
    if (!object(request) || Object.keys(request).length !== 1 || request.approved !== true) throw longInvalidRequest("Episode narration generation requires explicit approval.");
    const id = projectId.trim(); const episode = await this.episode(id, number); this.assertHasScript(episode);
    const projectSettings = (await this.projects.get(id)).project.settings;
    if (!projectSettings.narrationEnabled) throw longEpisodeNarrationNotEnabled();
    const scenes = this.scriptScenes(episode, this.sceneCount(episode));

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const generated: SceneNumber[] = []; const reused: SceneNumber[] = []; const skipped: SceneNumber[] = [];
    /** Scenes whose paid call landed but whose cost could not be written down — providers/budget-ledger.ts. */
    const unrecordedScenes: SceneNumber[] = [];
    const noteUnrecorded = async () => { if (unrecordedScenes.length > 0) await persistEpisodeWarning(this.files(id, number), number, episode, spendUnrecordedWarning(`${unrecordedScenes.join(", ")}번 장면 내레이션 생성`, OPENAI_LEDGER_FILE)); };
    try {
      await fs.mkdir(this.files(id, number).narration, { recursive: true });
      const existingRecords = await this.loadRecords(id, number);
      for (let index = 0; index < scenes.length; index += 1) {
        const sceneNumber = (index + 1) as SceneNumber;
        const text = this.sceneNarrationText(scenes[index]!);
        const destination = this.narrationPath(id, number, sceneNumber);
        if (!text) { skipped.push(sceneNumber); continue; }
        if (await this.validAudio(destination) && this.stillGoodAudio(existingRecords, sceneNumber, text, Boolean(apiKey && this.budget))) { reused.push(sceneNumber); continue; }

        let bytes: Buffer = PLACEHOLDER_MP3; let adapter = PLACEHOLDER_ADAPTER; let apiCalls = 0;
        if (apiKey && this.budget) {
          await this.budget.preflight(TTS_ESTIMATED_COST_USD);
          let succeeded = false;
          try { const result = await callOpenAiTtsApi(apiKey, text); bytes = result.bytes; succeeded = true; }
          finally {
          // `recordSpend`, not a bare await: this is a `finally` around a paid call, so a throw here discards
          // what OpenAI was already paid for and, on the failure path, replaces the provider's real error
          // (providers/budget-ledger.ts, docs/06_DECISIONS.md D-037).
            if (await recordSpend(() => this.budget!.record(id, "tts", succeeded, TTS_ESTIMATED_COST_USD))) unrecordedScenes.push(sceneNumber);
          }
          adapter = OPENAI_TTS_MODEL; apiCalls = 1;
        }
        await this.writeAudio(destination, bytes);
        if (!(await this.validAudio(destination))) throw new Error("invalid audio");
        await this.putRecord(id, number, { scene_number: sceneNumber, narration: text, checkpoint: "completed", adapter, tts_api_calls: apiCalls });
        generated.push(sceneNumber);
      }
      // Said once for the whole run, and on both ways out: a ledger that breaks mid-run stops the next scene at
      // its own preflight, so the run leaves through the catch below and this line never runs. Without the same
      // call there, everything bought before the break goes unmentioned.
      await noteUnrecorded();
    } catch (error) {
      await noteUnrecorded();
      if (isBudgetLedgerUnreadable(error)) throw longBudgetLedgerUnreadable(); if (error instanceof OpenAiBudgetExceededError) throw longEpisodeNarrationBudgetExceeded(error.message);
      if (error instanceof OpenAiAdapterError) throw longEpisodeNarrationProviderError(error.category, error.message);
      if (error instanceof Error && error.message === "invalid audio") throw longEpisodeNarrationGenerationFailed();
      throw longEpisodeNarrationStorageError();
    }

    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
    const budget = apiKey && this.budget && unrecordedScenes.length === 0 ? await budgetPreviewFor(this.budget, generated.length * TTS_ESTIMATED_COST_USD) : undefined;
    return { episode: this.detail(episode), generatedSceneNumbers: generated, reusedSceneNumbers: reused, skippedSceneNumbers: skipped, ...(budget ? { budget } : {}) };
  }

  async regenerate(projectId: string, number: number, rawSceneNumber: string, body: unknown): Promise<RegenerateLongEpisodeNarrationResponse> {
    if (!object(body) || body.approved !== true || Object.keys(body).some((key) => key !== "approved" && key !== "additionalInstruction") || (body.additionalInstruction !== undefined && typeof body.additionalInstruction !== "string")) throw longInvalidRequest("Episode narration regeneration requires explicit approval.");
    const additionalInstruction = typeof body.additionalInstruction === "string" ? body.additionalInstruction.trim() : "";
    const id = projectId.trim(); const episode = await this.episode(id, number); this.assertHasScript(episode);
    const sceneNumbers = sceneNumbersFor(this.sceneCount(episode));
    const number_ = Number(rawSceneNumber);
    if (!Number.isInteger(number_) || String(number_) !== rawSceneNumber || !sceneNumbers.includes(number_ as SceneNumber)) throw longInvalidRequest("Episode narration scene number is invalid.");
    const sceneNumber = number_ as SceneNumber;
    const projectSettings = (await this.projects.get(id)).project.settings;
    if (!projectSettings.narrationEnabled) throw longEpisodeNarrationNotEnabled();
    const scenes = this.scriptScenes(episode, this.sceneCount(episode));
    const text = this.sceneNarrationText(scenes[sceneNumber - 1]!);
    if (!text) throw longEpisodeNarrationMissingText();

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    let bytes: Buffer = PLACEHOLDER_MP3; let adapter = PLACEHOLDER_ADAPTER; let apiCalls = 0;
    let retryEstimate: RegenerateLongEpisodeNarrationResponse["retryEstimate"];
    /** The money is gone and the ledger does not know — carried to the warning and past the estimate below. */
    let spendUnrecorded = false;
    if (apiKey && this.budget) {
      try {
        await this.budget.preflight(TTS_ESTIMATED_COST_USD);
        let succeeded = false;
        try {
          const result = await callOpenAiTtsApi(apiKey, text, additionalInstruction ? { instructions: additionalInstruction } : {});
          bytes = result.bytes; succeeded = true;
        } finally {
          // `recordSpend`, not a bare await: this is a `finally` around a paid call, so a throw here discards
          // what OpenAI was already paid for and, on the failure path, replaces the provider's real error
          // (providers/budget-ledger.ts, docs/06_DECISIONS.md D-037).
          spendUnrecorded = await recordSpend(() => this.budget!.record(id, "tts", succeeded, TTS_ESTIMATED_COST_USD));
        }
      } catch (error) {
        if (isBudgetLedgerUnreadable(error)) throw longBudgetLedgerUnreadable(); if (error instanceof OpenAiBudgetExceededError) throw longEpisodeNarrationBudgetExceeded(error.message);
        if (error instanceof OpenAiAdapterError) throw longEpisodeNarrationProviderError(error.category, error.message);
        throw longEpisodeNarrationProviderError("unknown", OPENAI_KOREAN_MESSAGES.unknown);
      }
      adapter = OPENAI_TTS_MODEL; apiCalls = 1;
      // Read-only, computed after the fact. Skipped when the record could not be written — same file, so it
      // would throw and take the response, and the audio just paid for, with it. The field is already optional.
      if (!spendUnrecorded) retryEstimate = { perSceneCostUsd: TTS_ESTIMATED_COST_USD, budget: await budgetPreviewFor(this.budget, TTS_ESTIMATED_COST_USD) };
      if (spendUnrecorded) await persistEpisodeWarning(this.files(id, number), number, episode, spendUnrecordedWarning(`${sceneNumber}번 장면 내레이션 재생성`, OPENAI_LEDGER_FILE));
    }

    const destination = this.narrationPath(id, number, sceneNumber);
    try { await fs.mkdir(path.dirname(destination), { recursive: true }); await this.writeAudio(destination, bytes); if (!(await this.validAudio(destination))) throw new Error(); } catch { throw longEpisodeNarrationStorageError(); }
    await this.putRecord(id, number, { scene_number: sceneNumber, narration: text, checkpoint: "completed", adapter, tts_api_calls: apiCalls, regenerated: true });

    return { episode: this.detail(episode), narrations: await this.toApiNarrations(id, number, scenes), staleness: await this.narrationStaleness(id, number, scenes), sceneNumber, ...(retryEstimate ? { retryEstimate } : {}) };
  }

  async content(projectId: string, number: number, rawSceneNumber: string): Promise<{ path: string; extension: ".mp3" }> {
    const id = projectId.trim(); const episode = await this.episode(id, number);
    const sceneNumbers = sceneNumbersFor(this.sceneCount(episode));
    const number_ = Number(rawSceneNumber);
    const scene = Number.isInteger(number_) && sceneNumbers.includes(number_ as SceneNumber) ? (number_ as SceneNumber) : undefined;
    if (!scene) throw longEpisodeNarrationContentUnavailable();
    const file = this.narrationPath(id, number, scene);
    if (!(await this.validAudio(file))) throw longEpisodeNarrationContentUnavailable();
    return { path: file, extension: ".mp3" };
  }
}
