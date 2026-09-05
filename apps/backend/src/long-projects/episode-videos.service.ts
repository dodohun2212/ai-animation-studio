import * as crypto from "node:crypto";
import { isBudgetLedgerUnreadable, RUNWAY_LEDGER_FILE, spendUnrecordedWarning } from "../providers/budget-ledger.js";
import { persistEpisodeWarning } from "./episode-warnings.js";
import { PLACEHOLDER_MP4 } from "../videos/placeholder-clip.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { LONG_EPISODE_STATUSES, isSceneNumber, RUNWAY_PROMPT_MAX_LENGTH, sceneNumbersFor, VIDEO_SCENE_ESTIMATED_COST_USD, type ApproveLongEpisodeVideoReviewRequest, type ApproveLongEpisodeVideoReviewResponse, type GetLongEpisodeCurrentVideoJobResponse, type GetLongEpisodeVideoPreviewResponse, type GetLongEpisodeVideoReviewResponse, type LongEpisodeDetail, type LongEpisodeStatus, type LongEpisodeVideoProgress, type LongEpisodeVideoReview, type LongEpisodeVideoStaleness, type GetVideoVersionsResponse, type RecoverLongEpisodeVideosResponse, type RegenerateLongEpisodeVideoResponse, type RestoreLongEpisodeVideoVersionResponse, type SceneNumber, type StartLongEpisodeVideoGenerationRequest, type StartLongEpisodeVideoGenerationResponse } from "@ai-animation-studio/shared";
import { validateImage } from "../assets/image-validation.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { resolveSafeProjectDirectory } from "../projects/project-id.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget, RunwayBudgetExceededError } from "../providers/runway-budget.js";
import { advanceRunwayScene, RUNWAY_POLL_INTERVAL_SECONDS, type RunwayAdvanceResult, type RunwaySceneState } from "../videos/runway-workflow-support.js";
import { downloadRunwayOutput, getRunwayTask, RunwayAdapterError } from "../videos/runway-video-adapter.js";
import { ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { promptFor, utf16Length, type StoredScene, describesSameScene } from "../videos/video-preview.service.js";
import { longBudgetLedgerUnreadable, longEpisodeVideoRestoreNotAllowed, longEpisodeVideoVersionNotFound, longLocked, longEpisodeNotFound, longEpisodeVideoJobNotFound, longEpisodeVideosInvalid, longEpisodeVideosNotAllowed, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { toEpisodeDetail } from "./episode-detail.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";

/** Matches video-preview.service.ts's SCENE_FIELDS (minus "number", "narration"): the fields promptFor() reads. */
const MOTION_SCENE_FIELDS = ["description", "visual_action", "start_motion", "main_motion", "end_motion", "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject", "camera_motion", "environment_motion", "motion_speed", "motion_intensity", "expression_change", "continuity_hint"] as const;
/** The local fake path's bytes, shared so nothing can hold a second opinion about them. */
const MP4 = PLACEHOLDER_MP4;
const statuses: readonly LongEpisodeStatus[] = LONG_EPISODE_STATUSES;
type ObjectMap = { [key: string]: unknown };
type Episode = ObjectMap & { number: number; state: LongEpisodeStatus; approved: boolean; script: { scenes?: unknown }; script_revision: number; updated_at: string; duration_seconds: number; scene_count?: number };
/** `prompt` is what was actually sent to the provider — a submission has to be reproducible from it. `base_prompt` is the plain scene prompt, present only when a one-off regeneration instruction made the two differ, and it is what staleness compares against. */
type VideoRecord = { scene_number: SceneNumber; job_id: string; user_request_id: string; confirmation_id: string; input_hash: string; prompt: string; base_prompt?: string; status: "created" | "running" | "succeeded" | "interrupted" | "failed"; execution_mode: "local_fake_no_provider" | "runway"; completed_at?: string; runway_task_id?: string; runway_submitted_at?: string; runway_last_checked_at?: string; error?: string };
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
  private async loadEpisode(id: string, number: number): Promise<Episode> { if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound(); const f = this.files(id, number); const outlines = await this.json(f.outlines); if (!Array.isArray(outlines) || number > outlines.length || !object(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound(); let raw: unknown;
    // See episode-images.service.ts's episode(): an Episode listed in the outline but never scripted has no
    // directory yet, and reporting that as "Long project was not found" sends the person looking for something
    // that is not missing. A scripted Episode in the wrong state already gets this answer.
    try { raw = await this.json(f.project); }
    catch (error) { if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) throw longEpisodeVideosNotAllowed(); throw error; }
    if (!object(raw) || raw.number !== number || !statuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !object(raw.script) || !Number.isInteger(raw.script_revision) || typeof raw.updated_at !== "string") throw longInvalidData(); return raw as Episode; }
  private detail(episode: Episode): LongEpisodeDetail { return toEpisodeDetail(episode); }
  private async saveEpisode(id: string, number: number, episode: Episode) { const f = this.files(id, number); const outlines = await this.json(f.outlines); if (!Array.isArray(outlines) || !object(outlines[number - 1])) throw longInvalidData(); const copy = [...outlines]; copy[number - 1] = { ...copy[number - 1], status: episode.state }; try { await atomicWriteUtf8File(f.project, JSON.stringify(episode, null, 2)); await atomicWriteUtf8File(f.outlines, JSON.stringify(copy, null, 2)); } catch { throw longStorageError(); } }
  private image(id: string, number: number, value: SceneNumber) { return path.join(this.files(id, number).images, `scene${value}.png`); }
  /**
   * One scene's clip, for a player on the review screen.
   *
   * Nothing could watch these before: the short project had a content route and the Episode did not, so the
   * review card showed a filename and a status. Six 32-byte stubs were approved through that screen — a player
   * there is what turns "succeeded" into something a person can check.
   *
   * `realVideo`, not `validVideo`: serving a placeholder would render an empty player, which is the same claim
   * the stub made on disk.
   */
  async content(projectId: string, number: number, rawSceneNumber: string): Promise<{ path: string }> {
    const id = projectId.trim();
    const episode = await this.loadEpisode(id, number);
    const value = Number(rawSceneNumber);
    if (!isSceneNumber(value) || String(value) !== rawSceneNumber || value > this.sceneCount(episode)) throw longEpisodeVideosInvalid();
    const file = this.video(id, number, value);
    if (!(await this.realVideo(file))) throw longEpisodeVideosInvalid();
    return { path: file };
  }

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
    return this.promptWithOmissions(current, previous, durationSeconds, ratio).prompt;
  }
  /**
   * The same call, keeping what it already returned and this side used to throw away.
   *
   * promptFor drops sections in a fixed order to fit Runway's limit and names the ones it cut. The short
   * project has shown that list on its preview since it shipped; the Episode discarded it, so a scene here
   * could lose its pacing or performance direction and the only way to find out was that the finished clip
   * was wrong — after paying for it.
   */
  private promptWithOmissions(current: ObjectMap, previous: ObjectMap | undefined, durationSeconds: 5 | 10, ratio: "720:1280" | "1280:720"): { prompt: string; omittedSections: string[] } {
    try { return promptFor(current as unknown as StoredScene, previous as unknown as StoredScene | undefined, ratio, durationSeconds); }
    catch { throw longInvalidData(); }
  }
  private async assertReady(id: string, number: number, episode: Episode) { const scenes = sceneNumbersFor(this.sceneCount(episode)); if (episode.state !== "waiting_for_video_confirmation") throw longEpisodeVideosNotAllowed(); if (!(await Promise.all(scenes.map((item) => this.validImage(this.image(id, number, item))))).every(Boolean)) throw longEpisodeVideosInvalid(); const raw = await this.json(path.join(this.files(id, number).videos, "..", "generated_image_reviews.json")); if (!Array.isArray(raw) || !scenes.every((item) => raw.some((review) => object(review) && review.scene_number === item && review.status === "approved"))) throw longEpisodeVideosInvalid(); }
  private parseRecords(raw: unknown, sceneCount: number, job?: string): VideoRecord[] { if (!Array.isArray(raw)) throw longInvalidData(); const values = raw.map((item) => { if (!object(item) || !scene(item.scene_number) || !validId(item.job_id) || !validId(item.user_request_id) || typeof item.confirmation_id !== "string" || typeof item.input_hash !== "string" || typeof item.prompt !== "string" || (item.base_prompt !== undefined && typeof item.base_prompt !== "string") || !["created", "running", "succeeded", "interrupted", "failed"].includes(String(item.status)) || (item.execution_mode !== "local_fake_no_provider" && item.execution_mode !== "runway")) throw longInvalidData(); return item as VideoRecord; }).filter((item) => !job || item.job_id === job).sort((a, b) => a.scene_number - b.scene_number); const scenes = sceneNumbersFor(sceneCount); if (job && (values.length !== scenes.length || values.some((item, index) => item.scene_number !== scenes[index]))) throw longEpisodeVideoJobNotFound(); return values; }
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
  private async progressFor(episode: Episode, job: string, records: VideoRecord[]): Promise<LongEpisodeVideoProgress> { const done = records.filter((item) => item.status === "succeeded").map((item) => item.scene_number); const failedRecords = records.filter((item) => item.status === "failed"); const failed = failedRecords.map((item) => item.scene_number); const sceneErrors = Object.fromEntries(failedRecords.filter((item) => item.error).map((item) => [item.scene_number, item.error!])); const running = records.find((item) => item.status === "running")?.scene_number; const budget = records[0]?.execution_mode === "runway" ? await this.budgetPreview(VIDEO_SCENE_ESTIMATED_COST_USD) : undefined; return { paidProvider: records[0]?.execution_mode === "runway", jobId: job, status: episode.state === "interrupted" ? "interrupted" : failed.length > 0 ? "failed" : done.length === records.length && episode.state !== "videos_generating" ? "succeeded" : running || done.length === records.length ? "running" : "created", ...(running ? { currentSceneNumber: running } : {}), completedSceneNumbers: done, failedSceneNumbers: failed, sceneNumbers: records.map((item) => item.scene_number), episode: this.detail(episode), ...(Object.keys(sceneErrors).length > 0 ? { sceneErrors } : {}), ...(budget ? { retryEstimate: { perSceneCostUsd: VIDEO_SCENE_ESTIMATED_COST_USD, budget, pendingSceneCount: records.filter((item) => item.status !== "succeeded").length } } : {}) }; }
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
      // Two refusals from the same gate, written as two reasons because they send the person to opposite places
      // — the short-project side splits them the same way (videos/local-video-workflow.service.ts).
      //
      // The ledger one used to be thrown rather than recorded, and that is only half a behaviour: a poll saw the
      // error, but the background timer swallows everything (`.catch(() => undefined)` at its call sites), so on
      // a tick the refusal vanished and the timer kept ticking against a job that could never move. Recorded, it
      // reaches both. The frontend already maps `budget_ledger_unreadable` as a scene error for Episodes
      // (apps/frontend/src/api/longProjectsApi.ts) — the sentence existed; nothing here ever produced it.
      const reason = isBudgetLedgerUnreadable(error) ? "budget_ledger_unreadable"
        : error instanceof RunwayBudgetExceededError ? "budget_exceeded"
          : undefined;
      if (reason) {
        const created = records.find((record) => record.status === "created");
        if (!created) return records;
        created.status = "failed"; created.error = reason;
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
      await this.noteUnrecordedSpend(id, number, result);
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
    await this.noteUnrecordedSpend(id, number, result);

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
  /**
   * Says that a scene was paid for and the ledger does not know it.
   *
   * The clip itself is kept — that is `spendUnrecorded`'s whole point (docs/06_DECISIONS.md D-037) — so the only
   * thing left is telling the person, and an Episode's warnings are read from two places at once
   * (episode-warnings.ts). Loading the Episode here rather than threading it through every branch keeps this off
   * the path that runs on every ordinary tick.
   */
  private async noteUnrecordedSpend(id: string, number: number, result: RunwayAdvanceResult & { spendUnrecorded?: true }): Promise<void> {
    if (!result.spendUnrecorded || !("sceneNumber" in result)) return;
    const episode = await this.loadEpisode(id, number).catch(() => undefined);
    if (!episode) return;
    const files = this.files(id, number);
    // `{ [key: string]: unknown }` rather than the built-in Record, which this file shadows with its own
    // `type Record = VideoRecord` alias for the video records it works with.
    await persistEpisodeWarning({ project: files.project, outlines: files.outlines }, number, episode as unknown as { [key: string]: unknown }, spendUnrecordedWarning(`${result.sceneNumber}번 장면의 영상`, RUNWAY_LEDGER_FILE));
  }

  /** RunwayBudget's ledger scopes cost records by a single project_id string with no episode dimension of its own, so Episode video spend is keyed by this composite to keep one Episode's per-scene cost from merging with another Episode of the same long project. Never affects the shared monthly budget total, which is time-scoped only. */
  private budgetProjectKey(id: string, number: number): string { return `${id}:episode${number}`; }
  /**
   * Read-only, never reserves anything. So an unreadable ledger costs this a number rather than costing the
   * caller its whole response: `progressFor` reads it on every poll, and its throw used to answer a bare 500 for
   * a job that was otherwise fine to report on — including the one report that says a paid clip is here and the
   * month's total is short. Retrying is still refused where it matters, at `preflight`, which reads the same
   * file and throws (docs/06_DECISIONS.md D-036: what runs on top of this number is display).
   */
  private async budgetPreview(estimatedCostUsd: number): Promise<GetLongEpisodeVideoPreviewResponse["budget"]> {
    if (!this.budget) return undefined;
    let spentUsd: number; let remainingUsd: number;
    try { [spentUsd, remainingUsd] = await Promise.all([this.budget.spentThisMonth(), this.budget.remaining()]); }
    catch (error) { if (isBudgetLedgerUnreadable(error)) return undefined; throw error; }
    return { monthlyLimitUsd: this.budget.monthlyLimitUsd, spentUsd, remainingUsd, estimatedRequestCostUsd: estimatedCostUsd, canSpend: estimatedCostUsd <= remainingUsd };
  }
  async preview(projectId: string, number: number): Promise<GetLongEpisodeVideoPreviewResponse> { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); await this.assertReady(id, number, episode); const sceneNumbers = sceneNumbersFor(this.sceneCount(episode)); const durationSecondsPerScene = this.durationSecondsPerScene(episode); const ratio = await this.ratio(id, number); const scenes = this.scenes(episode); const items = scenes.map((item, index) => { const built = this.promptWithOmissions(item, scenes[index - 1], durationSecondsPerScene, ratio); return { sceneNumber: sceneNumbers[index]!, prompt: built.prompt, estimatedCostUsd: VIDEO_SCENE_ESTIMATED_COST_USD, ...(built.omittedSections.length > 0 ? { omittedSections: built.omittedSections } : {}) }; }); const hash = crypto.createHash("sha256").update(id).update(String(number)); for (const item of items) { hash.update(await fs.readFile(this.image(id, number, item.sceneNumber))); hash.update(item.prompt); } const estimatedCostUsd = items.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
    // Read-only: previewing never reserves or records budget, it only reports the ledger's current state.
    const budget = await this.budgetPreview(estimatedCostUsd);
    return { confirmationId: hash.digest("hex"), model: "gen4_turbo", ratio, durationSecondsPerScene, executionMode: "sequential", scenes: items, estimatedCostUsd, maximumProviderCalls: sceneNumbers.length, ...(budget ? { budget } : {}) }; }
  /**
   * Two presses at once used to produce two answers and one job.
   *
   * `start()` read the records file, checked the Episode's state, then wrote the file and the state. Nothing
   * serialized that, so two calls with different `userRequestId` — two tabs, two clients — both read an empty
   * records file, both passed the state gate, and the second write replaced the first. Measured, not reasoned:
   * both callers came back with a job id and only one of those jobs existed on disk, so the loser's screen
   * asked about its job forever and got LONG_EPISODE_VIDEO_JOB_NOT_FOUND after being told the run had started.
   *
   * 🟢 It never double-charged, and the reason is worth writing down because it is not `userRequestId`: the
   * existing records are read *before* the state gate, so a second call that arrives after the first has
   * written `videos_generating` is refused by the gate and never reaches the write, and one that arrives
   * before it saw an empty file and overwrote rather than appended. Money was safe by an accident of ordering
   * — docs/04_INTERNAL_API_CONTRACT.md is explicit that the state gate is what stops the second charge, and
   * this is that gate holding while everything around it slipped.
   *
   * Locked now, like every other money-adjacent path in this file and its siblings. The second caller waits,
   * then meets the state gate honestly: "already generating" instead of a job id that was never written.
   */
  async start(projectId: string, number: number, request: StartLongEpisodeVideoGenerationRequest): Promise<StartLongEpisodeVideoGenerationResponse> {
    const id = projectId.trim();
    try {
      return await withProjectLock(resolveSafeProjectDirectory(this.projectsRoot, id), `${id}:episode-${number}:videos-start`,
        () => this.startCore(id, number, request));
    } catch (error) {
      if (error instanceof ProjectLockTimeoutError) throw longLocked("Episode video generation");
      throw error;
    }
  }
  private async startCore(projectId: string, number: number, request: StartLongEpisodeVideoGenerationRequest): Promise<StartLongEpisodeVideoGenerationResponse> { const id = projectId.trim(); if (!object(request) || Object.keys(request).length !== 4 || !validId(request.userRequestId) || typeof request.confirmationId !== "string" || request.approved !== true || !Array.isArray(request.prompts)) throw longInvalidRequest("Episode video start request is invalid."); const episode = await this.loadEpisode(id, number); const sceneNumbers = sceneNumbersFor(this.sceneCount(episode)); if (request.prompts.length !== sceneNumbers.length) throw longInvalidRequest("Episode video start request is invalid."); const existing = await this.records(id, number, this.sceneCount(episode)).catch((error) => error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404 ? [] : Promise.reject(error)); const same = existing.filter((item) => item.user_request_id === request.userRequestId); if (same.length) { const jobId = same[0]!.job_id; if (same.some((item, index) => item.prompt !== request.prompts[index]?.prompt || item.confirmation_id !== request.confirmationId)) throw longInvalidRequest("Episode video request ID conflicts with a previous request."); return { jobId, acceptedSceneNumbers: [...sceneNumbers], episode: this.detail(episode), paidProvider: same[0]!.execution_mode === "runway" }; } const preview = await this.preview(id, number); if (preview.confirmationId !== request.confirmationId || request.prompts.some((item, index) => !object(item) || item.sceneNumber !== sceneNumbers[index])) throw longInvalidRequest("Episode video confirmation is stale."); // The prompt itself is the person's to change. It used to have to match the preview byte for byte, which
    // made the editable box on the screen a lie: every edit came back as "확인해 주세요" with nothing saying
    // what was wrong. `confirmationId` is what guards against a stale confirmation — it is derived from the
    // scenes, so a script that moved underneath still fails here — and the short project has always accepted
    // an edited prompt. What has to be checked is the shape, which nothing was checking at all.
    if (request.prompts.some((item) => typeof item.prompt !== "string" || !item.prompt.trim() || utf16Length(item.prompt) > RUNWAY_PROMPT_MAX_LENGTH)) throw longInvalidRequest(`장면 프롬프트는 비어 있을 수 없고 ${RUNWAY_PROMPT_MAX_LENGTH}자를 넘을 수 없습니다.`); const jobId = crypto.randomUUID(); const at = new Date().toISOString(); const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("runway") : null; const executionMode: VideoRecord["execution_mode"] = apiKey && this.budget ? "runway" : "local_fake_no_provider"; // The submitted prompt, not the previewed one. Relaxing the check above without this would have accepted an
    // edit and then generated from the text the person had just replaced — a worse failure than refusing it,
    // because nothing would have said so and the video would simply not be what they asked for.
    const records: Record[] = preview.scenes.map((item, index) => { const prompt = request.prompts[index]!.prompt; return { scene_number: item.sceneNumber, job_id: jobId, user_request_id: request.userRequestId, confirmation_id: request.confirmationId, input_hash: crypto.createHash("sha256").update(prompt).digest("hex"), prompt, status: "created" as const, execution_mode: executionMode }; }); await this.saveRecords(id, number, [...existing, ...records]); episode.state = "videos_generating"; episode.updated_at = at; await this.saveEpisode(id, number, episode); return { jobId, acceptedSceneNumbers: [...sceneNumbers], episode: this.detail(episode), paidProvider: executionMode === "runway" }; }
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
  /**
   * The two things an Episode keeps past copies of: one scene's clip, and the merged final video.
   *
   * `"final"` is a target here rather than a second set of methods, for the reason the short project's video
   * library made it one — every rule that matters (archive before overwriting, list newest first, restoring is
   * free and itself reversible) is the same rule, and a second implementation of it is a second place for a
   * paid file to be replaced with no copy kept.
   */
  private historyDirectory(id: string, number: number, target: SceneNumber | "final"): string {
    const videos = this.files(id, number).videos;
    return target === "final" ? path.join(videos, "final", "history") : path.join(videos, "history");
  }
  private historyFile(id: string, number: number, target: SceneNumber | "final", version: number): string {
    const prefix = target === "final" ? "instagram_reel_v" : `scene${target}_v`;
    return path.join(this.historyDirectory(id, number, target), `${prefix}${String(version).padStart(3, "0")}.mp4`);
  }
  /** The file this target serves today. */
  private currentFile(id: string, number: number, target: SceneNumber | "final"): string {
    return target === "final" ? path.join(this.files(id, number).videos, "final", "instagram_reel.mp4") : this.video(id, number, target);
  }
  /**
   * The version numbers already archived for one target, in ascending order.
   *
   * "The directory is not there yet" is the first archive and reads as none. Every other failure throws, and
   * that difference matters because this list is not only listed — `archive()` takes the highest number and
   * adds one. A readdir that failed for any other reason (a lock, a permission, an I/O error — none of them
   * exotic on Windows) came back empty, numbering restarted at v001, and the copy landed on top of a clip that
   * was already there. That clip was bought from Runway.
   *
   * The image side of the same operation has always thrown here (`episode-images.service.ts` regenerate: mkdir,
   * then readdir, inside a try that raises a storage error). Two implementations of one question, and only one
   * of them could overwrite paid work — docs/06_DECISIONS.md D-036's third question is what separates them.
   */
  private async historyVersions(id: string, number: number, target: SceneNumber | "final"): Promise<number[]> {
    let entries: string[];
    try { entries = await fs.readdir(this.historyDirectory(id, number, target)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw longStorageError(); }
    const pattern = target === "final" ? /^instagram_reel_v(\d{3})\.mp4$/ : new RegExp(String.raw`^scene${target}_v(\d{3})\.mp4$`);
    return entries.map((name) => pattern.exec(name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1])).sort((a, b) => a - b);
  }
  /**
   * Copies the clip about to be displaced into `history/` under the next version number.
   *
   * `scene{n}_v{NNN}.mp4` — the short project's format, deliberately not a second one. This used to write
   * `scene{n}_{timestamp}.mp4`, which no reader in the app could parse, so every regenerated Episode clip was
   * archived into a shape nothing could list, play or restore. Paid work piling up where nobody can reach it
   * is the same defect as paid work being overwritten; it is only quieter.
   */
  async archive(id: string, number: number, target: SceneNumber | "final"): Promise<void> {
    const bytes = await fs.readFile(this.currentFile(id, number, target)).catch(() => undefined);
    if (!bytes || bytes.length === 0) return;
    const versions = await this.historyVersions(id, number, target);
    await fs.mkdir(this.historyDirectory(id, number, target), { recursive: true });
    await this.binary(this.historyFile(id, number, target, (versions.at(-1) ?? 0) + 1), bytes);
  }

  private async fileFacts(file: string): Promise<{ bytes: number; createdAt: string } | undefined> {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size <= 0) return undefined;
      return { bytes: stat.size, createdAt: stat.mtime.toISOString() };
    } catch { return undefined; }
  }

  /** The scene number this Episode actually has, or a refusal — shared by all three version routes. */
  private async sceneOf(projectId: string, number: number, rawScene: string): Promise<{ id: string; episode: Episode; value: SceneNumber | "final" }> {
    const id = projectId.trim();
    const episode = await this.loadEpisode(id, number);
    // "final" addresses the merged video, on the same three routes, exactly as the short project's video
    // library does. One vocabulary for one idea: a past copy of something this Episode already paid for.
    if (rawScene === "final") return { id, episode, value: "final" };
    const value = scene(Number(rawScene));
    if (!value || String(value) !== rawScene || value > this.sceneCount(episode)) throw longInvalidRequest();
    return { id, episode, value };
  }

  async versions(projectId: string, number: number, rawScene: string): Promise<GetVideoVersionsResponse> {
    const { id, value } = await this.sceneOf(projectId, number, rawScene);
    const current = await this.fileFacts(this.currentFile(id, number, value));
    const archived = await Promise.all((await this.historyVersions(id, number, value)).map(async (version) => {
      const facts = await this.fileFacts(this.historyFile(id, number, value, version));
      return facts ? { versionId: `v${String(version).padStart(3, "0")}`, createdAt: facts.createdAt, bytes: facts.bytes, isCurrent: false, sortKey: version } : undefined;
    }));
    // Newest first, with `current` ahead of them: `isCurrent` marks what is served today, which is not
    // necessarily the newest by date once an older version has been restored.
    const rows = archived.filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => b.sortKey - a.sortKey).map(({ sortKey: _sortKey, ...rest }) => rest);
    return { versions: current ? [{ versionId: "current", createdAt: current.createdAt, bytes: current.bytes, isCurrent: true }, ...rows] : rows };
  }

  private versionFile(id: string, number: number, value: SceneNumber | "final", versionId: string): string {
    if (versionId === "current") return this.currentFile(id, number, value);
    const match = /^v(\d{3})$/.exec(versionId);
    if (!match) throw longEpisodeVideoVersionNotFound();
    return this.historyFile(id, number, value, Number(match[1]));
  }

  async versionContent(projectId: string, number: number, rawScene: string, versionId: string): Promise<{ path: string }> {
    const { id, value } = await this.sceneOf(projectId, number, rawScene);
    const file = this.versionFile(id, number, value, versionId);
    // `realVideo`, not merely "exists": a placeholder here would draw a black box claiming to be the clip
    // someone is deciding whether to restore, and informing that decision is the whole point of the player.
    if (!(await this.realVideo(file))) throw longEpisodeVideoVersionNotFound();
    return { path: file };
  }

  /**
   * Makes a past clip current again. Free — a local file copy, never a provider call — and never destructive:
   * the clip being displaced is archived first, so a restore is itself reversible.
   *
   * It does void the merged final video, because the scenes it was built from no longer match. The Episode
   * comes back with its final path cleared and, if it had been completed, its state at `videos_approved`. The
   * short project's restore makes exactly this trade for exactly this reason.
   */
  async restoreVersion(projectId: string, number: number, rawScene: string, versionId: string, body: unknown): Promise<RestoreLongEpisodeVideoVersionResponse> {
    if (!object(body) || Object.keys(body).length !== 1 || body.approved !== true) throw longInvalidRequest("Restoring a past clip requires explicit approval.");
    const { id, value } = await this.sceneOf(projectId, number, rawScene);
    if (versionId === "current") throw longEpisodeVideoRestoreNotAllowed();
    const source = this.versionFile(id, number, value, versionId);
    const bytes = await fs.readFile(source).catch(() => undefined);
    if (!bytes || bytes.length === 0) throw longEpisodeVideoVersionNotFound();

    return withProjectLock(path.dirname(this.files(id, number).records), `videos_restore_${number}`, async () => {
      const episode = await this.loadEpisode(id, number);
      try {
        await this.archive(id, number, value);
        await this.binary(this.currentFile(id, number, value), bytes);
      } catch { throw longStorageError(); }
      // A scene restore voids the merged video (it was built from clips that no longer match). A final-video
      // restore is the opposite: it *is* the merged video, so the Episode comes back completed and pointing at
      // it. Treating both the same would have thrown away the very cut the person just chose.
      const restored: Episode = value === "final"
        ? { ...episode, updated_at: new Date().toISOString(), final_video_path: "videos/final/instagram_reel.mp4", state: "completed" as const }
        : { ...episode, updated_at: new Date().toISOString(), final_video_path: null };
      if (value !== "final" && episode.state === "completed") restored.state = "videos_approved";
      await this.saveEpisode(id, number, restored);
      return { episode: this.detail(restored) };
    });
  }

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

  async regenerate(projectId: string, number: number, job: string, rawScene: string, body: unknown): Promise<RegenerateLongEpisodeVideoResponse> {
    const selected = scene(Number(rawScene));
    if (!selected || String(selected) !== rawScene) throw longInvalidRequest();
    return this.regenerateScenes(projectId, number, job, [selected], body);
  }

  /**
   * Re-buys every scene of this job in one press.
   *
   * An Episode could only be regenerated one scene at a time, so a twelve-scene Episode whose script changed
   * meant twelve presses — and the twelfth is where someone stops checking what they are approving. The short
   * project has had this since its own review screen existed.
   *
   * Deliberately no cheaper than the twelve presses: every scene is submitted and every scene is charged. What
   * this removes is the repetition, not the cost, and the screen has to keep saying the cost.
   */
  async regenerateAll(projectId: string, number: number, job: string, body: unknown): Promise<RegenerateLongEpisodeVideoResponse> {
    const id = projectId.trim();
    const episode = await this.loadEpisode(id, number);
    return this.regenerateScenes(projectId, number, job, sceneNumbersFor(this.sceneCount(episode)), body);
  }

  /** One path for one scene and for all of them — the rules that guard money must not have two implementations. */
  private async regenerateScenes(projectId: string, number: number, job: string, selection: readonly SceneNumber[], body: unknown): Promise<RegenerateLongEpisodeVideoResponse> {
    if (!object(body) || body.approved !== true || Object.keys(body).some((key) => key !== "approved" && key !== "additionalInstruction") || (body.additionalInstruction !== undefined && typeof body.additionalInstruction !== "string")) throw longInvalidRequest("Episode video regeneration requires explicit approval.");
    const additionalInstruction = typeof body.additionalInstruction === "string" ? body.additionalInstruction.trim() : "";
    const id = projectId.trim();
    const episode = await this.loadEpisode(id, number);
    if (selection.length === 0 || selection.some((item) => item > this.sceneCount(episode))) throw longInvalidRequest();
    const records = await this.records(id, number, this.sceneCount(episode), job);
    const allowedTerminal = ["videos_review", "videos_approved"].includes(episode.state);
    // A failed scene may be retried mid-generation; a whole-Episode re-buy may not, because the scenes still
    // running would be paid for twice.
    const allowedFailedRetry = selection.length === 1 && episode.state === "videos_generating"
      && records.find((item) => item.scene_number === selection[0])?.status === "failed";
    if (!allowedTerminal && !allowedFailedRetry) throw longEpisodeVideosNotAllowed();

    for (const selected of selection) {
      const file = this.video(id, number, selected);
      if (await this.validVideo(file)) await this.archive(id, number, selected);
      const record = records.find((item) => item.scene_number === selected)!;
      if (additionalInstruction) { const base = record.base_prompt ?? record.prompt; record.base_prompt = base; record.prompt = `${base}
${additionalInstruction}`; }
      record.status = "created";
      delete record.completed_at; delete record.runway_task_id; delete record.runway_submitted_at; delete record.runway_last_checked_at; delete record.error;
    }
    await this.saveRecords(id, number, records);
    const reviews = (await this.loadReviews(id, number, true)).filter((item) => !selection.includes(item.scene_number));
    await this.saveReviews(id, number, reviews);
    episode.state = "videos_generating"; episode.updated_at = new Date().toISOString();
    await this.saveEpisode(id, number, episode);
    const result = await this.run(id, number, job);
    return { ...result, regeneratedSceneNumbers: [...selection] };
  }

  async review(projectId: string, number: number, job: string): Promise<GetLongEpisodeVideoReviewResponse> { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); const sceneNumbers = sceneNumbersFor(this.sceneCount(episode)); const records = await this.records(id, number, this.sceneCount(episode), job); if (!["videos_review", "videos_approved"].includes(episode.state) || !(await Promise.all(sceneNumbers.map((item) => this.validVideo(this.video(id, number, item))))).every(Boolean)) throw longEpisodeVideosNotAllowed(); const reviews = await this.loadReviews(id, number, true); const now = episode.updated_at; const costsByScene = this.budget ? await this.budget.costsByScene(this.budgetProjectKey(id, number)) : {}; return { episode: this.detail(episode), reviews: sceneNumbers.map((item) => { const review = reviews.find((value) => value.scene_number === item); const costUsd = costsByScene[item]; return { sceneNumber: item, status: review?.status || "pending", updatedAt: review?.updated_at || now, ...(costUsd !== undefined ? { costUsd } : {}) }; }), staleness: await this.videoStaleness(id, number, episode, records) }; }
  /**
   * Which clips were paid for against a script that has since changed.
   *
   * The same method the short project uses (scene-staleness.ts): rebuild the prompt from the scene as it stands
   * now and compare it to the one recorded at generation time. Never a stored flag — a flag has to be cleared
   * by whoever changes the scene, and the one thing certain about that is that someone will forget.
   *
   * Scene N can appear here without its own fields having been touched: `promptFor` reads scene N-1 for its
   * continuity cue, so an edit there changes what N's clip should have been. That falls out of recomputing
   * rather than needing propagation code, exactly as it does on the short side.
   *
   * A scene whose recomputed prompt cannot be built at all is left out. That is a broken script, not a stale
   * clip, and reporting it here would send someone to regenerate a video over a problem regeneration cannot fix.
   */
  private async videoStaleness(id: string, number: number, episode: Episode, records: VideoRecord[]): Promise<LongEpisodeVideoStaleness> {
    const scenes = this.scenes(episode);
    const durationSeconds = this.durationSecondsPerScene(episode);
    const ratio = await this.ratio(id, number);
    const videoStale: SceneNumber[] = [];
    for (const sceneNumber of sceneNumbersFor(this.sceneCount(episode))) {
      // Newest last: a scene regenerated more than once is only behind if its *latest* clip is.
      const recorded = [...records].reverse().find((record) => record.scene_number === sceneNumber);
      const current = scenes[sceneNumber - 1];
      if (!recorded || !current) continue;
      let recomputed: string | undefined;
      try { recomputed = this.prompt(current, scenes[sceneNumber - 2], durationSeconds, ratio); } catch { recomputed = undefined; }
      // The baseline, not the sent text: a clip re-submitted with one-off direction is not behind its script.
      // Values, not labels — see describesSameScene. Renaming a prompt section is not a scene edit. A clip
      // length or orientation change would be a third thing, but neither can move once an Episode has clips —
      // see LongEpisodeVideoStaleness, which is why this has one list where the short project has two.
      if (recomputed !== undefined && !describesSameScene(recorded.base_prompt ?? recorded.prompt, recomputed)) videoStale.push(sceneNumber);
    }
    return { videoStale };
  }

  async approve(projectId: string, number: number, job: string, rawScene: string, body: ApproveLongEpisodeVideoReviewRequest): Promise<ApproveLongEpisodeVideoReviewResponse> { if (!object(body) || Object.keys(body).length !== 1 || body.approved !== true) throw longInvalidRequest(); const selected = scene(Number(rawScene)); if (!selected || String(selected) !== rawScene) throw longInvalidRequest(); await this.review(projectId, number, job); const id = projectId.trim(); const episode = await this.loadEpisode(id, number); if (selected > this.sceneCount(episode)) throw longInvalidRequest(); const reviews = (await this.loadReviews(id, number, true)).filter((item) => item.scene_number !== selected); const now = new Date().toISOString(); reviews.push({ scene_number: selected, status: "approved", updated_at: now }); episode.state = sceneNumbersFor(this.sceneCount(episode)).every((item) => reviews.some((review) => review.scene_number === item && review.status === "approved")) ? "videos_approved" : "videos_review"; episode.updated_at = now; await this.saveReviews(id, number, reviews.sort((a, b) => a.scene_number - b.scene_number)); await this.saveEpisode(id, number, episode); return this.review(id, number, job); }
}
