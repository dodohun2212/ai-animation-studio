import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, TTS_ESTIMATED_COST_USD, type GetLongEpisodeNarrationReviewResponse, type LongEpisodeDetail, type LongEpisodeNarrationReview,
  type NarrationAudioState, type LongEpisodeStatus, type RegenerateLongEpisodeNarrationResponse, type SceneNumber, type StartLongEpisodeNarrationGenerationRequest, type StartLongEpisodeNarrationGenerationResponse } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError } from "../providers/openai-common.js";
import { callOpenAiTtsApi } from "../narration/openai-narration-adapter.js";
import { probeAudioDurationSeconds } from "../narration/audio-duration.js";
import { longEpisodeNarrationBudgetExceeded, longEpisodeNarrationContentUnavailable, longEpisodeNarrationGenerationFailed, longEpisodeNarrationMissingText, longEpisodeNarrationNotAllowed, longEpisodeNarrationNotEnabled, longEpisodeNarrationProviderError, longEpisodeNarrationStorageError, longEpisodeNotFound, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";
import { LongProjectsService } from "./long-projects.service.js";

/** A silent single-frame MP3, used in local-fake mode — mirrors narration/local-narration-generation.service.ts's identical placeholder. */
/**
 * Four bytes of MP3 header and no audio, written when there is no TTS credential so the rest of the pipeline
 * can still be walked. It is a placeholder, and the record below is the only thing that says so — the file
 * itself is indistinguishable from real narration to anything that only asks whether a file is there.
 */
const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
/** Named once, because the reuse decision and the record that drives it have to agree on it exactly. */
const PLACEHOLDER_ADAPTER = "local-fake-tts-adapter";
const statuses: readonly LongEpisodeStatus[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed", "failed"];
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
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  private async episode(projectId: string, number: number): Promise<StoredEpisode> {
    if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound();
    const files = this.files(projectId, number); const outlines = await this.json(files.outlines);
    if (!Array.isArray(outlines) || number > outlines.length || !object(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound();
    // Unlike the other Episode services, narration can legitimately be asked about before the Episode has ever
    // been touched by episode-scripts.service.ts (no state gate — see the shared contract's doc comment), so
    // its per-episode project.json file may not exist on disk yet at all. That is simply "no script yet", not a
    // storage error.
    let raw: unknown;
    try { raw = await this.json(files.project); }
    catch (error) { if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) throw longEpisodeNarrationNotAllowed(); throw error; }
    if (!object(raw) || raw.number !== number || !statuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !object(raw.script) || !Number.isInteger(raw.script_revision) || typeof raw.updated_at !== "string") throw longInvalidData();
    return raw as StoredEpisode;
  }
  /** Falls back to 6, matching every Episode stored before scene_count existed (see episode-scripts.service.ts's parseStored). */
  private sceneCount(episode: StoredEpisode): number { return Number.isInteger(episode.scene_count) ? episode.scene_count as number : 6; }
  private detail(episode: StoredEpisode): LongEpisodeDetail { const script = toApiEpisodeScript(episode.script); const warnings = withoutStaleEpisodeRecoveryWarnings(Array.isArray(episode.warnings) ? episode.warnings.filter((item): item is string => typeof item === "string") : [], episode.state); return { episodeNumber: episode.number, title: String(episode.title), summary: String(episode.summary), mainEvent: String(episode.core_event), conflict: String(episode.conflict), cliffhanger: String(episode.cliffhanger), nextEpisodeHook: String(episode.next_connection), status: episode.state, approved: episode.approved, scriptRevision: episode.script_revision, ...(script ? { script } : {}), scriptHistoryCount: Array.isArray(episode.script_history) ? episode.script_history.length : 0, ...(warnings.length > 0 ? { warnings } : {}) }; }
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
      const raw = await this.json(this.files(projectId, number).records);
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

  async get(projectId: string, number: number): Promise<GetLongEpisodeNarrationReviewResponse> {
    const id = projectId.trim(); const episode = await this.episode(id, number); this.assertHasScript(episode);
    const scenes = this.scriptScenes(episode, this.sceneCount(episode));
    const narrations = await this.toApiNarrations(id, number, scenes);
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, TTS_ESTIMATED_COST_USD) : undefined;
    return { episode: this.detail(episode), narrations, ...(budget ? { budget } : {}) };
  }

  async generate(projectId: string, number: number, request: StartLongEpisodeNarrationGenerationRequest): Promise<StartLongEpisodeNarrationGenerationResponse> {
    if (!object(request) || Object.keys(request).length !== 1 || request.approved !== true) throw longInvalidRequest("Episode narration generation requires explicit approval.");
    const id = projectId.trim(); const episode = await this.episode(id, number); this.assertHasScript(episode);
    const projectSettings = (await this.projects.get(id)).project.settings;
    if (!projectSettings.narrationEnabled) throw longEpisodeNarrationNotEnabled();
    const scenes = this.scriptScenes(episode, this.sceneCount(episode));

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const generated: SceneNumber[] = []; const reused: SceneNumber[] = []; const skipped: SceneNumber[] = [];
    try {
      await fs.mkdir(this.files(id, number).narration, { recursive: true });
      const existingRecords = await this.loadRecords(id, number);
      for (let index = 0; index < scenes.length; index += 1) {
        const sceneNumber = (index + 1) as SceneNumber;
        const text = this.sceneNarrationText(scenes[index]!);
        const destination = this.narrationPath(id, number, sceneNumber);
        if (!text) { skipped.push(sceneNumber); continue; }
        if (await this.validAudio(destination) && this.stillGoodAudio(existingRecords, sceneNumber, text, Boolean(apiKey && this.budget))) { reused.push(sceneNumber); continue; }

        let bytes: Buffer = FAKE_MP3; let adapter = PLACEHOLDER_ADAPTER; let apiCalls = 0;
        if (apiKey && this.budget) {
          await this.budget.preflight(TTS_ESTIMATED_COST_USD);
          let succeeded = false;
          try { const result = await callOpenAiTtsApi(apiKey, text); bytes = result.bytes; succeeded = true; }
          finally { await this.budget.record(id, "tts", succeeded, TTS_ESTIMATED_COST_USD); }
          adapter = "gpt-4o-mini-tts"; apiCalls = 1;
        }
        await this.writeAudio(destination, bytes);
        if (!(await this.validAudio(destination))) throw new Error("invalid audio");
        await this.putRecord(id, number, { scene_number: sceneNumber, narration: text, checkpoint: "completed", adapter, tts_api_calls: apiCalls });
        generated.push(sceneNumber);
      }
    } catch (error) {
      if (error instanceof OpenAiBudgetExceededError) throw longEpisodeNarrationBudgetExceeded(error.message);
      if (error instanceof OpenAiAdapterError) throw longEpisodeNarrationProviderError(error.category, error.message);
      if (error instanceof Error && error.message === "invalid audio") throw longEpisodeNarrationGenerationFailed();
      throw longEpisodeNarrationStorageError();
    }

    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, generated.length * TTS_ESTIMATED_COST_USD) : undefined;
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
    let bytes: Buffer = FAKE_MP3; let adapter = PLACEHOLDER_ADAPTER; let apiCalls = 0;
    let retryEstimate: RegenerateLongEpisodeNarrationResponse["retryEstimate"];
    if (apiKey && this.budget) {
      try {
        await this.budget.preflight(TTS_ESTIMATED_COST_USD);
        let succeeded = false;
        try {
          const result = await callOpenAiTtsApi(apiKey, text, additionalInstruction ? { instructions: additionalInstruction } : {});
          bytes = result.bytes; succeeded = true;
        } finally { await this.budget.record(id, "tts", succeeded, TTS_ESTIMATED_COST_USD); }
      } catch (error) {
        if (error instanceof OpenAiBudgetExceededError) throw longEpisodeNarrationBudgetExceeded(error.message);
        if (error instanceof OpenAiAdapterError) throw longEpisodeNarrationProviderError(error.category, error.message);
        throw longEpisodeNarrationProviderError("unknown", OPENAI_KOREAN_MESSAGES.unknown);
      }
      adapter = "gpt-4o-mini-tts"; apiCalls = 1;
      // Read-only, computed after the fact: reflects the ledger's state right after this regeneration's own record().
      retryEstimate = { perSceneCostUsd: TTS_ESTIMATED_COST_USD, budget: await budgetPreviewFor(this.budget, TTS_ESTIMATED_COST_USD) };
    }

    const destination = this.narrationPath(id, number, sceneNumber);
    try { await fs.mkdir(path.dirname(destination), { recursive: true }); await this.writeAudio(destination, bytes); if (!(await this.validAudio(destination))) throw new Error(); } catch { throw longEpisodeNarrationStorageError(); }
    await this.putRecord(id, number, { scene_number: sceneNumber, narration: text, checkpoint: "completed", adapter, tts_api_calls: apiCalls, regenerated: true });

    return { episode: this.detail(episode), narrations: await this.toApiNarrations(id, number, scenes), sceneNumber, ...(retryEstimate ? { retryEstimate } : {}) };
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
