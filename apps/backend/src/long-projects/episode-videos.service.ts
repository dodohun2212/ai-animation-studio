import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { RUNWAY_PROMPT_MAX_LENGTH, VIDEO_SCENE_ESTIMATED_COST_USD, type ApproveLongEpisodeVideoReviewRequest, type ApproveLongEpisodeVideoReviewResponse, type GetLongEpisodeVideoPreviewResponse, type GetLongEpisodeVideoReviewResponse, type LongEpisodeDetail, type LongEpisodeStatus, type LongEpisodeVideoProgress, type LongEpisodeVideoReview, type RegenerateLongEpisodeVideoResponse, type SceneNumber, type StartLongEpisodeVideoGenerationRequest, type StartLongEpisodeVideoGenerationResponse } from "@ai-animation-studio/shared";
import { validateImage } from "../assets/image-validation.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget, RunwayBudgetExceededError } from "../providers/runway-budget.js";
import { advanceRunwayScene, RUNWAY_POLL_INTERVAL_SECONDS, type RunwayAdvanceResult, type RunwaySceneState } from "../videos/runway-workflow-support.js";
import { longEpisodeNotFound, longEpisodeVideoJobNotFound, longEpisodeVideosInvalid, longEpisodeVideosNotAllowed, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { toApiEpisodeScript } from "./episode-script-format.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const satisfies readonly SceneNumber[];
const MP4 = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");
const statuses: readonly LongEpisodeStatus[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted"];
type ObjectMap = { [key: string]: unknown };
type Episode = ObjectMap & { number: number; state: LongEpisodeStatus; approved: boolean; script: { scenes?: unknown }; script_revision: number; updated_at: string; duration_seconds: number };
type VideoRecord = { scene_number: SceneNumber; job_id: string; user_request_id: string; confirmation_id: string; input_hash: string; prompt: string; status: "created" | "running" | "succeeded" | "interrupted" | "failed"; execution_mode: "local_fake_no_provider" | "runway"; completed_at?: string; runway_task_id?: string; runway_submitted_at?: string; runway_last_checked_at?: string; error?: string };
type Record = VideoRecord;
type Review = { scene_number: SceneNumber; status: "pending" | "approved"; updated_at: string };
const object = (value: unknown): value is ObjectMap => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const scene = (value: unknown): SceneNumber | undefined => Number.isInteger(value) && SCENES.includes(value as (typeof SCENES)[number]) ? value as SceneNumber : undefined;
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
  private files(id: string, number: number) { if (!isSafeProjectId(id)) throw longUnsafeId(); const root = path.join(resolveSafeProjectDirectory(this.projectsRoot, id), "long_story"); const episode = path.join(root, `Episode${String(number).padStart(2, "0")}`); const videos = path.join(episode, "videos"); return { root, outlines: path.join(root, "episode_outlines.json"), project: path.join(episode, "project.json"), images: path.join(episode, "images"), videos, records: path.join(episode, "video_generation_records.json"), reviews: path.join(episode, "generated_video_reviews.json") }; }
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  private async loadEpisode(id: string, number: number): Promise<Episode> { if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound(); const f = this.files(id, number); const outlines = await this.json(f.outlines); if (!Array.isArray(outlines) || number > outlines.length || !object(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound(); const raw = await this.json(f.project); if (!object(raw) || raw.number !== number || !statuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !object(raw.script) || !Number.isInteger(raw.script_revision) || typeof raw.updated_at !== "string") throw longInvalidData(); return raw as Episode; }
  private detail(episode: Episode): LongEpisodeDetail { const script = toApiEpisodeScript(episode.script); return { episodeNumber: episode.number, title: String(episode.title), summary: String(episode.summary), mainEvent: String(episode.core_event), conflict: String(episode.conflict), cliffhanger: String(episode.cliffhanger), nextEpisodeHook: String(episode.next_connection), status: episode.state, approved: episode.approved, scriptRevision: episode.script_revision, ...(script ? { script } : {}), scriptHistoryCount: Array.isArray(episode.script_history) ? episode.script_history.length : 0 }; }
  private async saveEpisode(id: string, number: number, episode: Episode) { const f = this.files(id, number); const outlines = await this.json(f.outlines); if (!Array.isArray(outlines) || !object(outlines[number - 1])) throw longInvalidData(); const copy = [...outlines]; copy[number - 1] = { ...copy[number - 1], status: episode.state }; try { await atomicWriteUtf8File(f.project, JSON.stringify(episode, null, 2)); await atomicWriteUtf8File(f.outlines, JSON.stringify(copy, null, 2)); } catch { throw longStorageError(); } }
  private image(id: string, number: number, value: SceneNumber) { return path.join(this.files(id, number).images, `scene${value}.png`); }
  private video(id: string, number: number, value: SceneNumber) { return path.join(this.files(id, number).videos, `scene${value}.mp4`); }
  private async validImage(file: string) { try { return validateImage(await fs.readFile(file), "scene.png", "image/png").extension === ".png"; } catch { return false; } }
  private async validVideo(file: string) { try { const bytes = await fs.readFile(file); return bytes.length >= MP4.length && bytes.subarray(4, 8).toString("ascii") === "ftyp"; } catch { return false; } }
  private scenes(episode: Episode): ObjectMap[] { const value = episode.script.scenes; if (!Array.isArray(value) || value.length !== 6 || value.some((item, index) => !object(item) || item.number !== index + 1 || typeof item.description !== "string" || !item.description.trim())) throw longInvalidData(); return value; }
  /**
   * Every Episode is a fixed 6 scenes (SCENES), and Runway's image-to-video generation only accepts a 5-second
   * or 10-second duration per clip — so LongProjectSettings.episodeDurationSeconds (30 or 60) maps onto exactly
   * one of those two per-scene durations. episode.duration_seconds is snapshotted onto the Episode at creation
   * time (see episode-timeline.service.ts's episodeData()) from the project's setting at that moment, so it can
   * predate this 30/60 constraint for an older project; coerce to the nearer valid value rather than reject.
   */
  private durationSecondsPerScene(episode: Episode): 5 | 10 { return Number(episode.duration_seconds) >= 45 ? 10 : 5; }
  private prompt(current: ObjectMap, previous: ObjectMap | undefined, durationSeconds: 5 | 10): string { const text = (key: string) => typeof current[key] === "string" ? current[key] as string : ""; const earlier = previous ? [previous.end_motion, previous.continuity_hint].filter((value): value is string => typeof value === "string" && Boolean(value)).join(" ") : ""; const value = [`Create one continuous cinematic ${durationSeconds}-second vertical image-to-video shot from the supplied exact first frame.`, `Continuity cue: ${earlier}`, `Opening movement: ${text("start_motion")}`, `Main action: ${text("main_motion")}`, `Ending movement: ${text("end_motion")}`, `Motivated camera: ${text("camera_motion")}`, `Environment: ${text("environment_motion")}`, "Maintain stable identity, anatomy, clothing, essential objects, lighting and scene continuity throughout the shot."].filter(Boolean).join("\n"); if (!value.trim() || value.length > RUNWAY_PROMPT_MAX_LENGTH) throw longInvalidData(); return value; }
  private async assertReady(id: string, number: number, episode: Episode) { if (episode.state !== "waiting_for_video_confirmation") throw longEpisodeVideosNotAllowed(); if (!(await Promise.all(SCENES.map((item) => this.validImage(this.image(id, number, item))))).every(Boolean)) throw longEpisodeVideosInvalid(); const raw = await this.json(path.join(this.files(id, number).videos, "..", "generated_image_reviews.json")); if (!Array.isArray(raw) || !SCENES.every((item) => raw.some((review) => object(review) && review.scene_number === item && review.status === "approved"))) throw longEpisodeVideosInvalid(); }
  private parseRecords(raw: unknown, job?: string): VideoRecord[] { if (!Array.isArray(raw)) throw longInvalidData(); const values = raw.map((item) => { if (!object(item) || !scene(item.scene_number) || !validId(item.job_id) || !validId(item.user_request_id) || typeof item.confirmation_id !== "string" || typeof item.input_hash !== "string" || typeof item.prompt !== "string" || !["created", "running", "succeeded", "interrupted", "failed"].includes(String(item.status)) || (item.execution_mode !== "local_fake_no_provider" && item.execution_mode !== "runway")) throw longInvalidData(); return item as VideoRecord; }).filter((item) => !job || item.job_id === job).sort((a, b) => a.scene_number - b.scene_number); if (job && (values.length !== 6 || values.some((item, index) => item.scene_number !== SCENES[index]))) throw longEpisodeVideoJobNotFound(); return values; }
  private async records(id: string, number: number, job?: string) { try { return this.parseRecords(await this.json(this.files(id, number).records), job); } catch (error) { if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404 && job) throw longEpisodeVideoJobNotFound(); throw error; } }
  private async saveRecords(id: string, number: number, values: VideoRecord[]) { try { await atomicWriteUtf8File(this.files(id, number).records, JSON.stringify(values, null, 2)); } catch { throw longStorageError(); } }
  private async loadReviews(id: string, number: number, absent = false): Promise<Review[]> { try { const raw = await this.json(this.files(id, number).reviews); if (!Array.isArray(raw)) throw longInvalidData(); return raw.map((item) => { if (!object(item) || !scene(item.scene_number) || !["pending", "approved"].includes(String(item.status)) || typeof item.updated_at !== "string") throw longInvalidData(); return item as Review; }); } catch (error) { if (absent && error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) return []; throw error; } }
  private async saveReviews(id: string, number: number, values: Review[]) { try { await atomicWriteUtf8File(this.files(id, number).reviews, JSON.stringify(values, null, 2)); } catch { throw longStorageError(); } }
  // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
  private async progressFor(episode: Episode, job: string, records: VideoRecord[]): Promise<LongEpisodeVideoProgress> { const done = records.filter((item) => item.status === "succeeded").map((item) => item.scene_number); const failedRecords = records.filter((item) => item.status === "failed"); const failed = failedRecords.map((item) => item.scene_number); const sceneErrors = Object.fromEntries(failedRecords.filter((item) => item.error).map((item) => [item.scene_number, item.error!])); const running = records.find((item) => item.status === "running")?.scene_number; const budget = records[0]?.execution_mode === "runway" ? await this.budgetPreview(VIDEO_SCENE_ESTIMATED_COST_USD) : undefined; return { jobId: job, status: episode.state === "interrupted" ? "interrupted" : failed.length > 0 ? "failed" : done.length === 6 ? "succeeded" : running ? "running" : "created", ...(running ? { currentSceneNumber: running } : {}), completedSceneNumbers: done, failedSceneNumbers: failed, episode: this.detail(episode), ...(Object.keys(sceneErrors).length > 0 ? { sceneErrors } : {}), ...(budget ? { retryEstimate: { perSceneCostUsd: VIDEO_SCENE_ESTIMATED_COST_USD, budget } } : {}) }; }
  private async binary(file: string) { const temp = `${file}.${crypto.randomUUID()}.tmp`; let done = false; try { await fs.writeFile(temp, MP4); await fs.rename(temp, file); done = true; } finally { if (!done) await fs.unlink(temp).catch(() => undefined); } }

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
    return { imageBytes, imageMimeType: "image/png", prompt: record.prompt, durationSeconds: this.durationSecondsPerScene(episode) };
  }

  /** Guards against a timer tick and a concurrent GET poll both trying to advance the same job at once. */
  private async advanceReal(id: string, number: number, job: string): Promise<VideoRecord[]> {
    const jobKey = `${id}:${number}:${job}`;
    if (this.advancing.has(jobKey)) return this.records(id, number, job);
    this.advancing.add(jobKey);
    try { return await this.advanceRealCore(id, number, job); }
    finally { this.advancing.delete(jobKey); }
  }

  private async advanceRealCore(id: string, number: number, job: string): Promise<VideoRecord[]> {
    const episode = await this.loadEpisode(id, number);
    const records = await this.records(id, number, job);
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
    await fs.mkdir(this.files(id, number).videos, { recursive: true });
    await this.binary(this.video(id, number, result.sceneNumber));
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
  async preview(projectId: string, number: number): Promise<GetLongEpisodeVideoPreviewResponse> { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); await this.assertReady(id, number, episode); const durationSecondsPerScene = this.durationSecondsPerScene(episode); const scenes = this.scenes(episode); const items = scenes.map((item, index) => ({ sceneNumber: SCENES[index]!, prompt: this.prompt(item, scenes[index - 1], durationSecondsPerScene), estimatedCostUsd: VIDEO_SCENE_ESTIMATED_COST_USD })); const hash = crypto.createHash("sha256").update(id).update(String(number)); for (const item of items) { hash.update(await fs.readFile(this.image(id, number, item.sceneNumber))); hash.update(item.prompt); } const estimatedCostUsd = items.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
    // Read-only: previewing never reserves or records budget, it only reports the ledger's current state.
    const budget = await this.budgetPreview(estimatedCostUsd);
    return { confirmationId: hash.digest("hex"), model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene, executionMode: "sequential", scenes: items, estimatedCostUsd, maximumProviderCalls: SCENES.length, ...(budget ? { budget } : {}) }; }
  async start(projectId: string, number: number, request: StartLongEpisodeVideoGenerationRequest): Promise<StartLongEpisodeVideoGenerationResponse> { const id = projectId.trim(); if (!object(request) || Object.keys(request).length !== 4 || !validId(request.userRequestId) || typeof request.confirmationId !== "string" || request.approved !== true || !Array.isArray(request.prompts) || request.prompts.length !== 6) throw longInvalidRequest("Episode video start request is invalid."); const episode = await this.loadEpisode(id, number); const existing = await this.records(id, number).catch((error) => error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404 ? [] : Promise.reject(error)); const same = existing.filter((item) => item.user_request_id === request.userRequestId); if (same.length) { const jobId = same[0]!.job_id; if (same.some((item, index) => item.prompt !== request.prompts[index]?.prompt || item.confirmation_id !== request.confirmationId)) throw longInvalidRequest("Episode video request ID conflicts with a previous request."); return { jobId, acceptedSceneNumbers: [...SCENES], episode: this.detail(episode) }; } const preview = await this.preview(id, number); if (preview.confirmationId !== request.confirmationId || request.prompts.some((item, index) => !object(item) || item.sceneNumber !== SCENES[index] || item.prompt !== preview.scenes[index]!.prompt)) throw longInvalidRequest("Episode video confirmation is stale."); const jobId = crypto.randomUUID(); const at = new Date().toISOString(); const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("runway") : null; const executionMode: VideoRecord["execution_mode"] = apiKey && this.budget ? "runway" : "local_fake_no_provider"; const records: Record[] = preview.scenes.map((item) => ({ scene_number: item.sceneNumber, job_id: jobId, user_request_id: request.userRequestId, confirmation_id: request.confirmationId, input_hash: crypto.createHash("sha256").update(item.prompt).digest("hex"), prompt: item.prompt, status: "created", execution_mode: executionMode })); await this.saveRecords(id, number, [...existing, ...records]); episode.state = "videos_generating"; episode.updated_at = at; await this.saveEpisode(id, number, episode); return { jobId, acceptedSceneNumbers: [...SCENES], episode: this.detail(episode) }; }
  async run(id: string, number: number, job: string): Promise<LongEpisodeVideoProgress> {
    let episode = await this.loadEpisode(id, number); let records = await this.records(id, number, job);
    if (episode.state === "videos_generating" && records[0]!.execution_mode === "runway") {
      records = await this.advanceReal(id, number, job);
      this.scheduleTimer(`${id}:${number}:${job}`, () => { void this.advanceReal(id, number, job).catch(() => undefined); });
      return this.progressFor(await this.loadEpisode(id, number), job, records);
    }
    for (const item of records) { if (this.stopped.has(job) || episode.state !== "videos_generating") return this.progressFor(episode, job, records); if (item.status === "succeeded" && await this.validVideo(this.video(id, number, item.scene_number))) continue; item.status = "running"; await this.saveRecords(id, number, records); await fs.mkdir(this.files(id, number).videos, { recursive: true }); await this.binary(this.video(id, number, item.scene_number)); item.status = "succeeded"; item.completed_at = new Date().toISOString(); await this.saveRecords(id, number, records); episode = await this.loadEpisode(id, number); }
    if (records.every((item) => item.status === "succeeded") && (await Promise.all(SCENES.map((item) => this.validVideo(this.video(id, number, item))))).every(Boolean)) { episode.state = "videos_review"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode); }
    return this.progressFor(episode, job, records);
  }
  async progress(projectId: string, number: number, job: string) { const id = projectId.trim(); let episode = await this.loadEpisode(id, number); let records = await this.records(id, number, job); if (episode.state === "videos_generating" && records[0]!.execution_mode === "runway") { records = await this.advanceReal(id, number, job); episode = await this.loadEpisode(id, number); this.scheduleTimer(`${id}:${number}:${job}`, () => { void this.advanceReal(id, number, job).catch(() => undefined); }); } return this.progressFor(episode, job, records); }
  async stop(projectId: string, number: number, job: string) { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); await this.records(id, number, job); if (episode.state !== "videos_generating") throw longEpisodeVideosNotAllowed(); this.stopped.add(job); this.clearTimer(`${id}:${number}:${job}`); episode.state = "interrupted"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode); return this.progress(id, number, job); }
  async restart(projectId: string, number: number, job: string) { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); await this.records(id, number, job); if (episode.state !== "interrupted") throw longEpisodeVideosNotAllowed(); this.stopped.delete(job); episode.state = "videos_generating"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode); return this.run(id, number, job); }
  async regenerate(projectId: string, number: number, job: string, rawScene: string, body: unknown): Promise<RegenerateLongEpisodeVideoResponse> { if (!object(body) || Object.keys(body).length !== 1 || body.approved !== true) throw longInvalidRequest("Episode video regeneration requires explicit approval."); const selected = scene(Number(rawScene)); if (!selected || String(selected) !== rawScene) throw longInvalidRequest(); const id = projectId.trim(); const episode = await this.loadEpisode(id, number); const records = await this.records(id, number, job); const allowedTerminal = ["videos_review", "videos_approved"].includes(episode.state); const allowedFailedRetry = episode.state === "videos_generating" && records.find((item) => item.scene_number === selected)?.status === "failed"; if (!allowedTerminal && !allowedFailedRetry) throw longEpisodeVideosNotAllowed(); const file = this.video(id, number, selected); if (await this.validVideo(file)) { const history = path.join(this.files(id, number).videos, "history"); await fs.mkdir(history, { recursive: true }); await fs.copyFile(file, path.join(history, `scene${selected}_${Date.now()}.mp4`)); } const record = records.find((item) => item.scene_number === selected)!; record.status = "created"; delete record.completed_at; delete record.runway_task_id; delete record.runway_submitted_at; delete record.runway_last_checked_at; delete record.error; await this.saveRecords(id, number, records); const reviews = (await this.loadReviews(id, number, true)).filter((item) => item.scene_number !== selected); await this.saveReviews(id, number, reviews); episode.state = "videos_generating"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode); const result = await this.run(id, number, job); return { ...result, regeneratedSceneNumbers: [selected] }; }
  async review(projectId: string, number: number, job: string): Promise<GetLongEpisodeVideoReviewResponse> { const id = projectId.trim(); const episode = await this.loadEpisode(id, number); await this.records(id, number, job); if (!["videos_review", "videos_approved"].includes(episode.state) || !(await Promise.all(SCENES.map((item) => this.validVideo(this.video(id, number, item))))).every(Boolean)) throw longEpisodeVideosNotAllowed(); const reviews = await this.loadReviews(id, number, true); const now = episode.updated_at; const costsByScene = this.budget ? await this.budget.costsByScene(this.budgetProjectKey(id, number)) : {}; return { episode: this.detail(episode), reviews: SCENES.map((item) => { const review = reviews.find((value) => value.scene_number === item); const costUsd = costsByScene[item]; return { sceneNumber: item, status: review?.status || "pending", updatedAt: review?.updated_at || now, ...(costUsd !== undefined ? { costUsd } : {}) }; }) }; }
  async approve(projectId: string, number: number, job: string, rawScene: string, body: ApproveLongEpisodeVideoReviewRequest): Promise<ApproveLongEpisodeVideoReviewResponse> { if (!object(body) || Object.keys(body).length !== 1 || body.approved !== true) throw longInvalidRequest(); const selected = scene(Number(rawScene)); if (!selected || String(selected) !== rawScene) throw longInvalidRequest(); await this.review(projectId, number, job); const id = projectId.trim(); const episode = await this.loadEpisode(id, number); const reviews = (await this.loadReviews(id, number, true)).filter((item) => item.scene_number !== selected); const now = new Date().toISOString(); reviews.push({ scene_number: selected, status: "approved", updated_at: now }); episode.state = SCENES.every((item) => reviews.some((review) => review.scene_number === item && review.status === "approved")) ? "videos_approved" : "videos_review"; episode.updated_at = now; await this.saveReviews(id, number, reviews.sort((a, b) => a.scene_number - b.scene_number)); await this.saveEpisode(id, number, episode); return this.review(id, number, job); }
}
