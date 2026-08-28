import * as crypto from "node:crypto";
import { PLACEHOLDER_MP4 } from "../videos/placeholder-clip.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { isSceneNumber, RUNWAY_PROMPT_MAX_LENGTH, sceneNumbersFor, VIDEO_SCENE_ESTIMATED_COST_USD, type ApproveLongEpisodeVideoReviewRequest, type ApproveLongEpisodeVideoReviewResponse, type GetLongEpisodeCurrentVideoJobResponse, type GetLongEpisodeVideoPreviewResponse, type GetLongEpisodeVideoReviewResponse, type LongEpisodeDetail, type LongEpisodeStatus, type LongEpisodeVideoProgress, type LongEpisodeVideoReview, type RecoverLongEpisodeVideosResponse, type RegenerateLongEpisodeVideoResponse, type SceneNumber, type StartLongEpisodeVideoGenerationRequest, type StartLongEpisodeVideoGenerationResponse } from "@ai-animation-studio/shared";
import { validateImage } from "../assets/image-validation.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { resolveSafeProjectDirectory } from "../projects/project-id.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget, RunwayBudgetExceededError } from "../providers/runway-budget.js";
import { advanceRunwayScene, RUNWAY_POLL_INTERVAL_SECONDS, type RunwayAdvanceResult, type RunwaySceneState } from "../videos/runway-workflow-support.js";
import { downloadRunwayOutput, getRunwayTask, RunwayAdapterError } from "../videos/runway-video-adapter.js";
import { ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { promptFor, utf16Length, type StoredScene } from "../videos/video-preview.service.js";
import { longLocked, longEpisodeNotFound, longEpisodeVideoJobNotFound, longEpisodeVideosInvalid, longEpisodeVideosNotAllowed, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";

/** Matches video-preview.service.ts's SCENE_FIELDS (minus "number", "narration"): the fields promptFor() reads. */
const MOTION_SCENE_FIELDS = ["description", "visual_action", "start_motion", "main_motion", "end_motion", "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject", "camera_motion", "environment_motion", "motion_speed", "motion_intensity", "expression_change", "continuity_hint"] as const;
/** The local fake path's bytes, shared so nothing can hold a second opinion about them. */
const MP4 = PLACEHOLDER_MP4;
const statuses: readonly LongEpisodeStatus[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted"];
type ObjectMap = { [key: string]: unknown };
type Episode = ObjectMap & { number: number; state: LongEpisodeStatus; approved: boolean; script: { scenes?: unknown }; script_revision: number; updated_at: string; duration_seconds: number; scene_count?: number };
type VideoRecord = { scene_number: SceneNumber; job_id: string; user_request_id: string; confirmation_id: string; input_hash: string; prompt: string; status: "created" | "running" | "succeeded" | "interrupted" | "failed"; execution_mode: "local_fake_no_provider" | "runway"; completed_at?: string; runway_task_id?: string; runway_submitted_at?: string; runway_last_checked_at?: string; error?: string };
type Record = VideoRecord;
type Review = { scene_number: SceneNumber; status: "pending" | "approved"; updated_at: string };
const object = (value: unknown): value is ObjectMap => Boolean(value) && typeof value === "object" && !Array.isArray(value);
// Format-only check (1..MAX_SCENE_COUNT) — bounded to a specific episode's own scene_count separately once the
// episode has been loaded (see EpisodeVideosService.sceneCount()).
const scene = (value: unknown): SceneNumber | undefined => Number.isInteger(value) && isSceneNumber(value as number) ? value as SceneNumber : undefined;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

@Injectable()
export class EpisodeVideosService implements OnModuleDestroy {
  private readonly stopped = new Set<string>();
  private readonly activeTimers = new Map<string, NodeJS.Timeout>();
  private readonly advancing = new Set<string>();
  constructor(
    private readonly projectsRoot: string,
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: RunwayBudget,
  ) {}
  onModuleDestroy(): void { for (const timer of this.activeTimers.values()) clearInterval(timer); this.activeTimers.clear(); }
  private files(id: string, number: number) { const root = longStoryRoot(this.projectsRoot, id); const episode = path.join(root, episodeDirectoryName(number)); const videos = path.join(episode, "videos"); return { root, outlines: path.join(root, "episode_outlines.json"), longProject: path.join(root, "project.json"), project: path.join(episode, "project.json"), images: path.join(episode, "images"), videos, records: path.join(episode, "video_generation_records.json"), reviews: path.join(episode, "generated_video_reviews.json") }; }
  /** Same "9:16"/"16:9" -> Runway ratio mapping as episode-video-merge.service.ts's ratio(), and as video-preview.service.ts's ratioFor() for the short-project side. */
  private async ratio(id: string, number: number): Promise<"720:1280" | "1280:720"> {
    const raw = await this.json(this.files(id, number).longProject);
    if (!object(raw) || (raw.aspect_ratio !== "9:16" && raw.aspect_ratio !== "16:9")) throw longInvalidData();
    return raw.aspect_ratio === "16:9" ? "1280:720" : "720:1280";
  }
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  private async loadEpisode(id: string, number: number): Promise<Episode> { if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound(); const f = this.files(id, number); const outlines = await this.json(f.outlines); if (!Array.isArray(outlines) || number > outlines.length || !object(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound(); const raw = await this.json(f.project); if (!object(raw) || raw.number !== number || !statuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !object(raw.script) || !Number.isInteger(raw.script_revision) || typeof raw.updated_at !== "string") throw longInvalidData(); return raw as Episode; }
  private detail(episode: Episode): LongEpisodeDetail { const script = toApiEpisodeScript(episode.script); const warnings = withoutStaleEpisodeRecoveryWarnings(Array.isArray(episode.warnings) ? episode.warnings.filter((item): item is string => typeof item === "string") : [], episode.state); return { episodeNumber: episode.number, title: String(episode.title), summary: String(episode.summary), mainEvent: String(episode.core_event), conflict: String(episode.conflict), cliffhanger: String(episode.cliffhanger), nextEpisodeHook: String(episode.next_connection), status: episode.state, approved: episode.approved, scriptRevision: episode.script_revision, ...(script ? { script } : {}), scriptHistoryCount: Array.isArray(episode.script_history) ? episode.script_history.length : 0, ...(warnings.length > 0 ? { warnings } : {}) }; }
  private async saveEpisode(id: string, number: number, episode: Episode) { const f = this.files(id, number); const outlines = await this.json(f.outlines); if (!Array.isArray(outlines) || !object(outlines[number - 1])) throw longInvalidData(); const copy = [...outlines]; copy[number - 1] = { ...copy[number - 1], status: episode.state }; try { await atomicWriteUtf8File(f.project, JSON.stringify(episode, null, 2)); await atomicWriteUtf8File(f.outlines, JSON.stringify(copy, null, 2)); } catch { throw longStorageError(); } }
  private image(id: string, number: number, value: SceneNumber) { return path.join(this.files(id, number).images, `scene${value}.png`); }
  private video(id: string, number: number, value: SceneNumber) { return path.join(this.files(id, number).videos, `scene${value}.mp4`); }
  private async validImage(file: string) { try { return validateImage(await fs.readFile(file), "scene.png", "image/png").extension === ".png"; } catch { return false; } }
  private async validVideo(file: string) { try { const bytes = await fs.readFile(file); return bytes.length >= MP4.length && bytes.subarray(4, 8).toString("ascii") === "ftyp"; } catch { return false; } }
  /**
   * Whether the file holds an actual clip rather than the placeholder.
   *
   * `validVideo` cannot answer this: the placeholder is a valid `ftyp` box of exactly the minimum length, which
   * is why six paid clips could be replaced by stubs with every check still green. Recovery has to tell them
   * apart — asking `validVideo` first skipped every damaged scene, which is this same bug wearing a new hat.
   */
  private async realVideo(file: string) { try { const bytes = await fs.readFile(file); return bytes.length > MP4.length && bytes.subarray(4, 8).toString("ascii") === "ftyp"; } catch { return false; } }
  /** Falls back to 6, matching every Episode stored before scene_count existed (see episode-scripts.service.ts's parseStored). */
  private sceneCount(episode: Episode): number { return Number.isInteger(episode.scene_count) ? episode.scene_count as number : 6; }
  private scenes(episode: Episode): ObjectMap[] { const value = episode.script.scenes; const count = this.sceneCount(episode); if (!Array.isArray(value) || value.length !== count || value.some((item, index) => !object(item) || item.number !== index + 1 || MOTION_SCENE_FIELDS.some((key) => typeof item[key] !== "string" || !(item[key] as string).trim()))) throw longInvalidData(); return value; }
  /**
   * Runway's image-to-video generation only accepts a 5-second or 10-second duration per clip — so
   * LongProjectSettings.clipDurationSeconds maps directly onto one of those two per-scene durations, and the
   * project's own sceneCount (no longer a fixed 6) determines how many clips an Episode has (see sceneCount()
   * above). episode.duration_seconds is snapshotted onto the Episode at creation time (see
   * episode-timeline.service.ts's episodeData()) from the project's setting at that moment, so it can predate
   * this 5/10 constraint for an older project; coerce to the nearer valid value rather than reject.
   */
  private durationSecondsPerScene(episode: Episode): 5 | 10 { return Number(episode.duration_seconds) / this.sceneCount(episode) >= 7.5 ? 10 : 5; }
  /**
   * Delegates to video-preview.service.ts's promptFor() — the short-project and Long Episode script schemas use
   * the same 16 field names (see MOTION_SCENE_FIELDS/scenes() above), so the same function correctly reads all
   * of them (motion_speed, motion_intensity, and expression_change previously had no reader anywhere on the
   * Long Episode side; this was the actual fix, not a new prompt format). ratio is now derived from the
   * project's own aspectRatio setting via ratio() above — it used to be hardcoded to "720:1280" regardless of
   * that setting, so a 16:9 Long Project's Episodes were always rendered as vertical video.
   */
  private prompt(current: ObjectMap, previous: ObjectMap | undefined, durationSeconds: 5 | 10, ratio: "720:1280" | "1280:720"): string {
    try { return promptFor(current as unknown as StoredScene, previous as unknown as StoredScene | undefined, ratio, durationSeconds).prompt; }
    catch { throw longInvalidData(); }
  }
  private async assertReady(id: string, number: number, episode: Episode) { const scenes = sceneNumbersFor(this.sceneCount(episode)); if (episode.state !== "waiting_for_video_confirmation") throw longEpisodeVideosNotAllowed(); if (!(await Promise.all(scenes.map((item) => this.validImage(this.image(id, number, item))))).every(Boolean)) throw longEpisodeVideosInvalid(); const raw = await this.json(path.join(this.files(id, number).videos, "..", "generated_image_reviews.json")); if (!Array.isArray(raw) || !scenes.every((item) => raw.some((review) => object(review) && review.scene_number === item && review.status === "approved"))) throw longEpisodeVideosInvalid(); }
  private parseRecords(raw: unknown, sceneCount: number, job?: string): VideoRecord[] { if (!Array.isArray(raw)) throw longInvalidData(); const values = raw.map((item) => { if (!object(item) || !scene(item.scene_number) || !validId(item.job_id) || !validId(item.user_request_id) || typeof item.confirmation_id !== "string" || typeof item.input_hash !== "string" || typeof item.prompt !== "string" || !["created", "running", "succeeded", "interrupted", "failed"].includes(String(item.status)) || (item.execution_mode !== "local_fake_no_provider" && item.execution_mode !== "runway")) throw longInvalidData(); return item as VideoRecord; }).filter((item) => !job || item.job_id === job).sort((a, b) => a.scene_number - b.scene_number); const scenes = sceneNumbersFor(sceneCount); if (job && (values.length !== scenes.length || values.some((item, index) => item.scene_number !== scenes[index]))) throw longEpisodeVideoJobNotFound(); return values; }
  private async records(id: string, number: number, sceneCount: number, job?: string) { try { return this.parseRecords(await this.json(this.files(id, number).records), sceneCount, job); } catch (error) { if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404 && job) throw longEpisodeVideoJobNotFound(); throw error; } }
  private async saveRecords(id: string, number: number, values: VideoRecord[]) { try { await atomicWriteUtf8File(this.files(id, number).records, JSON.stringify(values, null, 2)); } catch { throw longStorageError(); } }
  private async loadReviews(id: string, number: number, absent = false): Promise<Review[]> { try { const raw = await this.json(this.files(id, number).reviews); if (!Array.isArray(raw)) throw longInvalidData(); return raw.map((item) => { if (!object(item) || !scene(item.scene_number) || !["pending", "approved"].includes(String(item.status)) || typeof item.updated_at !== "string") throw longInvalidData(); return item as Review; }); } catch (error) { if (absent && error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) return []; throw error; } }
  private async saveReviews(id: string, number: number, values: Review[]) { try { await atomicWriteUtf8File(this.files(id, number).reviews, JSON.stringify(values, null, 2)); } catch { throw longStorageError(); } }
  // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
  // Not "every scene is done" but "every scene is done and the next step is open". Those are two writes
  // apart — the last record is saved as succeeded, then the owner's state is moved — and a poll landing
  // between them used to answer "succeeded" while a review was still refused. Both screens open their
  // review on exactly this word, so it has to mean the thing they use it for. Still finishing reads as
  // running, which is what it is.
  private async progressFor(episode: Episode, job: string, records: VideoRecord[]): Promise<LongEpisodeVideoProgress> { const done = records.filter((item) => item.status === "succeeded").map((item) => item.scene_number); const failedRecords = records.filter((item) => item.status === "failed"); const failed = failedRecords.map((item) => item.scene_number); const sceneErrors = Object.fromEntries(failedRecords.filter((item) => item.error).map((item) => [item.scene_number, item.error!])); const running = records.find((item) => item.status === "running")?.scene_number; const budget = records[0]?.execution_mode === "runway" ? await this.budgetPreview(VIDEO_SCENE_ESTIMATED_COST_USD) : undefined; return { jobId: job, status: episode.state === "interrupted" ? "interrupted" : failed.length > 0 ? "failed" : done.length === records.length && episode.state !== "videos_generating" ? "succeeded" : running || done.length === records.length ? "running" : "created", ...(running ? { currentSceneNumber: running } : {}), completedSceneNumbers: done, failedSceneNumbers: failed, sceneNumbers: records.map((item) => item.scene_number), episode: this.detail(episode), ...(Object.keys(sceneErrors).length > 0 ? { sceneErrors } : {}), ...(budget ? { retryEstimate: { perSceneCostUsd: VIDEO_SCENE_ESTIMATED_COST_USD, budget } } : {}) }; }
  /**
   * Writes one scene's video. `bytes` is what Runway sent; the placeholder is only for the local fake path.
   *
   * It used to always write the placeholder, including on the real path's success branch — so a real Episode
   * was charged for six clips, the download arrived, and a 32-byte stub was written over it. Nothing said so:
   * the records read "succeeded" with real task ids, and the stub passes `validVideo`, which only checks for a
   * length and an `ftyp` box. The short project has always written `result.bytes` here; this side was ported
   * from the fake shape and the success branch never caught up.
   */
  private async binary(file: string, bytes: Buffer = MP4) { const temp = `${file}.${crypto.randomUUID()}.tmp`; let done = false; try { await fs.writeFile(temp, bytes); await fs.rename(temp, file); done = true; } finally { if (!done) await fs.unlink(temp).catch(() => undefined); } }

  private scheduleTimer(jobKey: string, tick: () => void): void {
    if (this.activeTimers.has(jobKey)) return;
    const timer = setInterval(tick, RUNWAY_POLL_INTERVAL_SECONDS * 1000);
    if (typeof timer.unref === "function") timer.unref();
    this.activeTimers.set(jobKey, timer);
  }
  private clearTimer(jobKey: string): void { const timer = this.activeTimers.get(jobKey); if (timer) { clearInterval(timer); this.activeTimers.delete(jobKey); } }

  private async runwayInputForScene(id: string, number: number, records: VideoRecord[], sceneNumber: SceneNumber) {
    const record = records.find((item) => item.scene_number === sceneNumber)!;
    const imageBytes = await fs.readFile(this.image(id, number, sceneNumber));
    const episode = await this.loadEpisode(id, number);
    const ratio = await this.ratio(id, number);
    return { imageBytes, imageMimeType: "image/png", prompt: record.prompt, durationSeconds: this.durationSecondsPerScene(episode), ratio };
  }

  /**
   * Guards against a timer tick and a concurrent GET poll both trying to advance the same job at once — but the
   * in-memory `advancing` Set only serializes calls within one Node process. `withProjectLock` additionally
   * guards the same race across two processes, exactly like local-video-workflow.service.ts's advanceReal() does
   * for short projects — see that lock's own doc comment for the confirmed incident (Round 152: a real, separately
   * -billed duplicate Runway task neither process's own polling noticed) this same architecture is exposed to on
   * the Long Episode side too (docs/06_DECISIONS.md D-005).
   */
  private async advanceReal(id: string, number: number, job: string): Promise<VideoRecord[]> {
    const jobKey = `${id}:${number}:${job}`;
    if (this.advancing.has(jobKey)) return this.records(id, number, this.sceneCount(await this.loadEpisode(id, number)), job);
    this.advancing.add(jobKey);
    try {
      return await withProjectLock(resolveSafeProjectDirectory(this.projectsRoot, id), jobKey, () => this.advanceRealCore(id, number, job));
    } catch (error) {
      // Normally the lock just waits — this only fires after real contention exceeds ACQUIRE_TIMEOUT_MS (10s),
      // which would otherwise surface as an unhandled exception instead of a proper API error the frontend can
      // show a specific, non-retry-encouraging message for (docs/06_DECISIONS.md D-010).
      if (error instanceof ProjectLockTimeoutError) throw longLocked("Episode video generation");
      throw error;
    } finally { this.advancing.delete(jobKey); }
  }

  private async advanceRealCore(id: string, number: number, job: string): Promise<VideoRecord[]> {
    const episode = await this.loadEpisode(id, number);
    const records = await this.records(id, number, this.sceneCount(episode), job);
    if (records[0]!.execution_mode !== "runway") return records;
    if (episode.state !== "videos_generating") return records;
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("runway") : null;
    if (!apiKey || !this.budget) return records;

    const states: RunwaySceneState[] = records.map((record) => ({
      sceneNumber: record.scene_number,
      status: record.status === "interrupted" ? "failed" : record.status,
      taskId: record.runway_task_id,
      submittedAt: record.runway_submitted_at,
      lastCheckedAt: record.runway_last_checked_at,
    }));

    let result: RunwayAdvanceResult;
    try {
      result = await advanceRunwayScene(states, (sceneNumber) => this.runwayInputForScene(id, number, records, sceneNumber), {
        apiSecret: apiKey, projectId: this.budgetProjectKey(id, number), apiType: "video",
        estimatedCostPerSceneUsd: VIDEO_SCENE_ESTIMATED_COST_USD, budget: this.budget,
      });
    } catch (error) {
      if (error instanceof RunwayBudgetExceededError) {
        const created = records.find((record) => record.status === "created");
        if (!created) return records;
        created.status = "failed"; created.error = "budget_exceeded";
        await this.saveRecords(id, number, records).catch(() => undefined);
        this.clearTimer(`${id}:${number}:${job}`);
        return records;
      }
      throw error;
    }
    return this.applyRunwayAdvance(id, number, job, records, result);
  }

  private async applyRunwayAdvance(id: string, number: number, job: string, records: VideoRecord[], result: RunwayAdvanceResult): Promise<VideoRecord[]> {
    const jobKey = `${id}:${number}:${job}`;
    if (result.kind === "unchanged" || result.kind === "check-error") return records;
    const record = records.find((item) => item.scene_number === result.sceneNumber)!;

    if (result.kind === "still-running") {
      record.runway_last_checked_at = new Date().toISOString();
      await this.saveRecords(id, number, records);
      return records;
    }
    if (result.kind === "submitted") {
      record.status = "running"; record.runway_task_id = result.taskId;
      record.runway_submitted_at = result.submittedAt; record.runway_last_checked_at = result.submittedAt;
      await this.saveRecords(id, number, records);
      this.scheduleTimer(jobKey, () => { void this.advanceReal(id, number, job).catch(() => undefined); });
      return records;
    }
    if (result.kind === "failed") {
      record.status = "failed"; record.error = result.error;
      await this.saveRecords(id, number, records);
      this.clearTimer(jobKey);
      return records;
    }
    // result.kind === "succeeded"
    // A body no bigger than the placeholder is not a video. Recording it as succeeded is what let six paid
    // clips be replaced by stubs without a word, so it is refused here instead — the scene is failed and can
    // be regenerated, rather than the Episode moving on to review with nothing to review.
    if (result.bytes.length <= MP4.length) {
      record.status = "failed"; record.error = "empty_output";
      await this.saveRecords(id, number, records);
      this.clearTimer(jobKey);
      return records;
    }
    await fs.mkdir(this.files(id, number).videos, { recursive: true });
    await this.binary(this.video(id, number, result.sceneNumber), result.bytes);
    record.status = "succeeded"; record.completed_at = new Date().toISOString();
    await this.saveRecords(id, number, records);

    if (records.every((item) => item.status === "succeeded")) {
      const episode = await this.loadEpisode(id, number);
      episode.state = "videos_review"; episode.updated_at = new Date().toISOString();
      await this.saveEpisode(id, number, episode);
      this.clearTimer(jobKey);
      return records;
    }
    // Immediately try to submit the next scene within this same call/timer-tick.
    return this.advanceRealCore(id, number, job);
  }
  /** RunwayBudget's ledger scopes cost records by a single project_id string with no episode dimension of its own, so Episode video spend is keyed by this composite to keep one Episode's per-scene cost from merging with another Episode of the same long project. Never affects the shared monthly budget total, which is time-scoped only. */
  private budgetProjectKey(id: string, number: number): string { return `${id}:episode${number}`; }
  private async budgetPreview(estimatedCostUsd: number): Promise<GetLongEpisodeVideoPreviewResponse["budget"]> {
    if (!this.budget) return undefined;
    const [spentUsd, remainingUsd] = await Promise.all([this.budget.spentThisMonth(), this.budget.remaining()]);
    return { monthlyLimitUsd: this.budget.monthlyLimitUsd, spentUsd, remainingUsd, estimatedRequestCostUsd: estimatedCostUsd, canSpend: estimatedCostUsd <= remainingUsd };
  }
  async preview(projectId: string, number: number): Promise<GetLongEpisodeVideoPreviewResponse> { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); await this.assertReady(id, number, episode); const sceneNumbers = sceneNumbersFor(this.sceneCount(episode)); const durationSecondsPerScene = this.durationSecondsPerScene(episode); const ratio = await this.ratio(id, number); const scenes = this.scenes(episode); const items = scenes.map((item, index) => ({ sceneNumber: sceneNumbers[index]!, prompt: this.prompt(item, scenes[index - 1], durationSecondsPerScene, ratio), estimatedCostUsd: VIDEO_SCENE_ESTIMATED_COST_USD })); const hash = crypto.createHash("sha256").update(id).update(String(number)); for (const item of items) { hash.update(await fs.readFile(this.image(id, number, item.sceneNumber))); hash.update(item.prompt); } const estimatedCostUsd = items.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
    // Read-only: previewing never reserves or records budget, it only reports the ledger's current state.
    const budget = await this.budgetPreview(estimatedCostUsd);
    return { confirmationId: hash.digest("hex"), model: "gen4_turbo", ratio, durationSecondsPerScene, executionMode: "sequential", scenes: items, estimatedCostUsd, maximumProviderCalls: sceneNumbers.length, ...(budget ? { budget } : {}) }; }
  async start(projectId: string, number: number, request: StartLongEpisodeVideoGenerationRequest): Promise<StartLongEpisodeVideoGenerationResponse> { const id = projectId.trim(); if (!object(request) || Object.keys(request).length !== 4 || !validId(request.userRequestId) || typeof request.confirmationId !== "string" || request.approved !== true || !Array.isArray(request.prompts)) throw longInvalidRequest("Episode video start request is invalid."); const episode = await this.loadEpisode(id, number); const sceneNumbers = sceneNumbersFor(this.sceneCount(episode)); if (request.prompts.length !== sceneNumbers.length) throw longInvalidRequest("Episode video start request is invalid."); const existing = await this.records(id, number, this.sceneCount(episode)).catch((error) => error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404 ? [] : Promise.reject(error)); const same = existing.filter((item) => item.user_request_id === request.userRequestId); if (same.length) { const jobId = same[0]!.job_id; if (same.some((item, index) => item.prompt !== request.prompts[index]?.prompt || item.confirmation_id !== request.confirmationId)) throw longInvalidRequest("Episode video request ID conflicts with a previous request."); return { jobId, acceptedSceneNumbers: [...sceneNumbers], episode: this.detail(episode) }; } const preview = await this.preview(id, number); if (preview.confirmationId !== request.confirmationId || request.prompts.some((item, index) => !object(item) || item.sceneNumber !== sceneNumbers[index])) throw longInvalidRequest("Episode video confirmation is stale."); // The prompt itself is the person's to change. It used to have to match the preview byte for byte, which
    // made the editable box on the screen a lie: every edit came back as "확인해 주세요" with nothing saying
    // what was wrong. `confirmationId` is what guards against a stale confirmation — it is derived from the
    // scenes, so a script that moved underneath still fails here — and the short project has always accepted
    // an edited prompt. What has to be checked is the shape, which nothing was checking at all.
    if (request.prompts.some((item) => typeof item.prompt !== "string" || !item.prompt.trim() || utf16Length(item.prompt) > RUNWAY_PROMPT_MAX_LENGTH)) throw longInvalidRequest(`장면 프롬프트는 비어 있을 수 없고 ${RUNWAY_PROMPT_MAX_LENGTH}자를 넘을 수 없습니다.`); const jobId = crypto.randomUUID(); const at = new Date().toISOString(); const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("runway") : null; const executionMode: VideoRecord["execution_mode"] = apiKey && this.budget ? "runway" : "local_fake_no_provider"; // The submitted prompt, not the previewed one. Relaxing the check above without this would have accepted an
    // edit and then generated from the text the person had just replaced — a worse failure than refusing it,
    // because nothing would have said so and the video would simply not be what they asked for.
    const records: Record[] = preview.scenes.map((item, index) => { const prompt = request.prompts[index]!.prompt; return { scene_number: item.sceneNumber, job_id: jobId, user_request_id: request.userRequestId, confirmation_id: request.confirmationId, input_hash: crypto.createHash("sha256").update(prompt).digest("hex"), prompt, status: "created" as const, execution_mode: executionMode }; }); await this.saveRecords(id, number, [...existing, ...records]); episode.state = "videos_generating"; episode.updated_at = at; await this.saveEpisode(id, number, episode); return { jobId, acceptedSceneNumbers: [...sceneNumbers], episode: this.detail(episode) }; }
  async run(id: string, number: number, job: string): Promise<LongEpisodeVideoProgress> {
    let episode = await this.loadEpisode(id, number); let records = await this.records(id, number, this.sceneCount(episode), job);
    if (episode.state === "videos_generating" && records[0]!.execution_mode === "runway") {
      records = await this.advanceReal(id, number, job);
      this.scheduleTimer(`${id}:${number}:${job}`, () => { void this.advanceReal(id, number, job).catch(() => undefined); });
      return this.progressFor(await this.loadEpisode(id, number), job, records);
    }
    for (const item of records) { if (this.stopped.has(job) || episode.state !== "videos_generating") return this.progressFor(episode, job, records); if (item.status === "succeeded" && await this.validVideo(this.video(id, number, item.scene_number))) continue; item.status = "running"; await this.saveRecords(id, number, records); await fs.mkdir(this.files(id, number).videos, { recursive: true }); await this.binary(this.video(id, number, item.scene_number)); item.status = "succeeded"; item.completed_at = new Date().toISOString(); await this.saveRecords(id, number, records); episode = await this.loadEpisode(id, number); }
    if (records.every((item) => item.status === "succeeded") && (await Promise.all(sceneNumbersFor(this.sceneCount(episode)).map((item) => this.validVideo(this.video(id, number, item))))).every(Boolean)) { episode.state = "videos_review"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode); }
    return this.progressFor(episode, job, records);
  }
  /**
   * The job this Episode is on, or null.
   *
   * Everything else here is addressed by a job id that only ever lived in one browser tab. Reload it and the
   * paid generation was still running with nothing able to look at it: progress needs the id, and preview —
   * the one route that hands one back — refuses once generation has started. This is the way back in.
   *
   * The most recent job wins rather than "a running one", because a finished job is still what a reloaded
   * review screen needs to show. Idleness is reported as null instead of an error: there being no job is an
   * ordinary answer to the question, not a failure to answer it.
   */
  async currentJob(projectId: string, number: number): Promise<GetLongEpisodeCurrentVideoJobResponse> {
    const id = projectId.trim();
    const episode = await this.loadEpisode(id, number);
    const records = await this.records(id, number, this.sceneCount(episode)).catch(() => []);
    return { jobId: records.length ? records[records.length - 1]!.job_id : null };
  }

  async progress(projectId: string, number: number, job: string) { const id = projectId.trim(); let episode = await this.loadEpisode(id, number); let records = await this.records(id, number, this.sceneCount(episode), job); if (episode.state === "videos_generating" && records[0]!.execution_mode === "runway") { records = await this.advanceReal(id, number, job); episode = await this.loadEpisode(id, number); this.scheduleTimer(`${id}:${number}:${job}`, () => { void this.advanceReal(id, number, job).catch(() => undefined); }); } return this.progressFor(episode, job, records); }
  async stop(projectId: string, number: number, job: string) { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); await this.records(id, number, this.sceneCount(episode), job); if (episode.state !== "videos_generating") throw longEpisodeVideosNotAllowed(); this.stopped.add(job); this.clearTimer(`${id}:${number}:${job}`); episode.state = "interrupted"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode); return this.progress(id, number, job); }
  async restart(projectId: string, number: number, job: string) { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); await this.records(id, number, this.sceneCount(episode), job); if (episode.state !== "interrupted") throw longEpisodeVideosNotAllowed(); this.stopped.delete(job); episode.state = "videos_generating"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode); return this.run(id, number, job); }
  /**
   * Fetches clips Runway already made, for scenes whose stored file is a placeholder.
   *
   * The bug that made this necessary wrote a 32-byte stub over every downloaded clip while the ledger recorded
   * six real charges. The tasks are still Runway's, their ids are in the records, and asking for a task's
   * output again is a read — so this adds nothing to the ledger. Regenerating would charge the same $1.50 a
   * second time for work already paid for.
   *
   * Scope is deliberately narrow: only scenes recorded as `succeeded` with a task id, and only when the file on
   * disk is not a real video. A scene already holding real bytes is left alone, and a scene that never
   * succeeded is not a recovery case — it is a generation the person has to decide about.
   *
   * A scene whose output cannot be fetched any more (task gone, URL expired, an empty body) is reported and
   * left `failed`, never silently regenerated: spending money is the person's decision, not a fallback.
   */
  async recover(projectId: string, number: number, job: string, body: unknown): Promise<RecoverLongEpisodeVideosResponse> {
    if (!object(body) || Object.keys(body).length !== 1 || body.approved !== true) throw longInvalidRequest("Episode video recovery requires explicit approval.");
    const id = projectId.trim();
    const episode = await this.loadEpisode(id, number);
    const records = await this.records(id, number, this.sceneCount(episode), job);
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("runway") : null;
    if (!apiKey) throw longEpisodeVideosNotAllowed();

    const recoveredSceneNumbers: SceneNumber[] = [];
    const unrecoverableScenes: { sceneNumber: SceneNumber; reason: string }[] = [];
    let changed = false;

    for (const record of records) {
      if (record.execution_mode !== "runway" || record.status !== "succeeded" || !record.runway_task_id) continue;
      if (await this.realVideo(this.video(id, number, record.scene_number))) continue;
      let bytes: Buffer;
      try {
        const task = await getRunwayTask(apiKey, record.runway_task_id);
        const url = task.outputUrls[0];
        if (task.status !== "SUCCEEDED" || !url) { unrecoverableScenes.push({ sceneNumber: record.scene_number, reason: "no_output" }); continue; }
        bytes = await downloadRunwayOutput(url);
      } catch (error) {
        unrecoverableScenes.push({ sceneNumber: record.scene_number, reason: error instanceof RunwayAdapterError ? String(error.category) : "unknown" });
        continue;
      }
      // The same refusal the generation path makes: a body no bigger than a bare header is not a video, and
      // writing it would repeat exactly the failure this recovery exists to undo.
      if (bytes.length <= MP4.length) {
        record.status = "failed"; record.error = "empty_output"; changed = true;
        unrecoverableScenes.push({ sceneNumber: record.scene_number, reason: "empty_output" });
        continue;
      }
      await fs.mkdir(this.files(id, number).videos, { recursive: true });
      await this.binary(this.video(id, number, record.scene_number), bytes);
      recoveredSceneNumbers.push(record.scene_number);
    }

    if (changed) await this.saveRecords(id, number, records);
    return { ...(await this.progressFor(episode, job, records)), recoveredSceneNumbers, unrecoverableScenes };
  }

  async regenerate(projectId: string, number: number, job: string, rawScene: string, body: unknown): Promise<RegenerateLongEpisodeVideoResponse> { if (!object(body) || Object.keys(body).length !== 1 || body.approved !== true) throw longInvalidRequest("Episode video regeneration requires explicit approval."); const selected = scene(Number(rawScene)); if (!selected || String(selected) !== rawScene) throw longInvalidRequest(); const id = projectId.trim(); const episode = await this.loadEpisode(id, number); if (selected > this.sceneCount(episode)) throw longInvalidRequest(); const records = await this.records(id, number, this.sceneCount(episode), job); const allowedTerminal = ["videos_review", "videos_approved"].includes(episode.state); const allowedFailedRetry = episode.state === "videos_generating" && records.find((item) => item.scene_number === selected)?.status === "failed"; if (!allowedTerminal && !allowedFailedRetry) throw longEpisodeVideosNotAllowed(); const file = this.video(id, number, selected); if (await this.validVideo(file)) { const history = path.join(this.files(id, number).videos, "history"); await fs.mkdir(history, { recursive: true }); await fs.copyFile(file, path.join(history, `scene${selected}_${Date.now()}.mp4`)); } const record = records.find((item) => item.scene_number === selected)!; record.status = "created"; delete record.completed_at; delete record.runway_task_id; delete record.runway_submitted_at; delete record.runway_last_checked_at; delete record.error; await this.saveRecords(id, number, records); const reviews = (await this.loadReviews(id, number, true)).filter((item) => item.scene_number !== selected); await this.saveReviews(id, number, reviews); episode.state = "videos_generating"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode); const result = await this.run(id, number, job); return { ...result, regeneratedSceneNumbers: [selected] }; }
  async review(projectId: string, number: number, job: string): Promise<GetLongEpisodeVideoReviewResponse> { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); const sceneNumbers = sceneNumbersFor(this.sceneCount(episode)); await this.records(id, number, this.sceneCount(episode), job); if (!["videos_review", "videos_approved"].includes(episode.state) || !(await Promise.all(sceneNumbers.map((item) => this.validVideo(this.video(id, number, item))))).every(Boolean)) throw longEpisodeVideosNotAllowed(); const reviews = await this.loadReviews(id, number, true); const now = episode.updated_at; const costsByScene = this.budget ? await this.budget.costsByScene(this.budgetProjectKey(id, number)) : {}; return { episode: this.detail(episode), reviews: sceneNumbers.map((item) => { const review = reviews.find((value) => value.scene_number === item); const costUsd = costsByScene[item]; return { sceneNumber: item, status: review?.status || "pending", updatedAt: review?.updated_at || now, ...(costUsd !== undefined ? { costUsd } : {}) }; }) }; }
  async approve(projectId: string, number: number, job: string, rawScene: string, body: ApproveLongEpisodeVideoReviewRequest): Promise<ApproveLongEpisodeVideoReviewResponse> { if (!object(body) || Object.keys(body).length !== 1 || body.approved !== true) throw longInvalidRequest(); const selected = scene(Number(rawScene)); if (!selected || String(selected) !== rawScene) throw longInvalidRequest(); await this.review(projectId, number, job); const id = projectId.trim(); const episode = await this.loadEpisode(id, number); if (selected > this.sceneCount(episode)) throw longInvalidRequest(); const reviews = (await this.loadReviews(id, number, true)).filter((item) => item.scene_number !== selected); const now = new Date().toISOString(); reviews.push({ scene_number: selected, status: "approved", updated_at: now }); episode.state = sceneNumbersFor(this.sceneCount(episode)).every((item) => reviews.some((review) => review.scene_number === item && review.status === "approved")) ? "videos_approved" : "videos_review"; episode.updated_at = now; await this.saveReviews(id, number, reviews.sort((a, b) => a.scene_number - b.scene_number)); await this.saveEpisode(id, number, episode); return this.review(id, number, job); }
}
