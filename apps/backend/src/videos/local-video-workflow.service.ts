import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  WorkflowState,
  type ApproveVideoReviewResponse,
  type GenerationProgressResponse,
  type GetVideoReviewResponse,
  type RegenerateVideoResponse,
  type SceneNumber,
  type VideoReview,
} from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget, RunwayBudgetExceededError, VIDEO_SCENE_ESTIMATED_COST_USD } from "../providers/runway-budget.js";
import { advanceRunwayScene, RUNWAY_POLL_INTERVAL_SECONDS, type RunwayAdvanceResult, type RunwaySceneState } from "./runway-workflow-support.js";
import { LEGACY_VIDEO_JOB_ID } from "./legacy-job.js";
import {
  invalidVideoWorkflowRequest,
  videoContentUnavailable,
  videoJobNotFound,
  videoReviewDataInvalid,
  videoStorageError,
  videoWorkflowNotAllowed,
} from "./video-workflow-api.error.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const satisfies readonly SceneNumber[];
const LOCAL_FAKE_MP4 = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");

type VideoStatus = "created" | "running" | "succeeded" | "interrupted" | "failed";
type VideoRecord = Record<string, unknown> & {
  scene_number: SceneNumber; job_id?: string; status: VideoStatus; execution_mode: "local_fake_no_provider" | "runway";
  runway_task_id?: string; runway_submitted_at?: string; runway_last_checked_at?: string; error?: string;
};
type StoredReview = { scene_number: SceneNumber; status: "pending" | "approved"; updated_at: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sceneNumber = (value: unknown): SceneNumber | undefined => typeof value === "number" && Number.isInteger(value) && SCENES.includes(value as SceneNumber) ? value as SceneNumber : undefined;
const sceneNumberFromParam = (raw: string): SceneNumber | undefined => {
  const value = Number(raw);
  return Number.isInteger(value) && String(value) === raw ? sceneNumber(value) : undefined;
};

/**
 * Normalizes a raw stored record, including a legacy Python-era shape that
 * has no job_id/execution_mode and named the field task_id instead of
 * runway_task_id. A record without a job_id defaults to the local-fake
 * execution mode: Python already produced its real output, and regenerating
 * it should never risk a real Runway call using fields Python never
 * persisted (model, duration_seconds) — see LEGACY_VIDEO_JOB_ID.
 */
function normalizeRecord(value: unknown): VideoRecord | undefined {
  if (!isObject(value)) return undefined;
  const scene = sceneNumber(value.scene_number);
  const status = String(value.status);
  if (!scene || !["created", "running", "succeeded", "interrupted", "failed"].includes(status)) return undefined;
  const jobId = typeof value.job_id === "string" ? value.job_id : undefined;
  const executionMode = value.execution_mode === "runway" || value.execution_mode === "local_fake_no_provider" ? value.execution_mode : "local_fake_no_provider";
  const runwayTaskId = typeof value.runway_task_id === "string" ? value.runway_task_id : typeof value.task_id === "string" ? value.task_id : undefined;
  return {
    ...value,
    scene_number: scene,
    status: status as VideoStatus,
    execution_mode: executionMode,
    ...(jobId !== undefined ? { job_id: jobId } : {}),
    ...(runwayTaskId !== undefined ? { runway_task_id: runwayTaskId } : {}),
  };
}

function parseReviews(raw: unknown): StoredReview[] {
  if (!Array.isArray(raw)) throw videoReviewDataInvalid();
  const reviews = raw.map((item) => {
    if (!isObject(item) || Object.keys(item).some((key) => !["scene_number", "status", "updated_at"].includes(key))) throw videoReviewDataInvalid();
    const number = sceneNumber(item.scene_number);
    if (!number || !["pending", "approved"].includes(String(item.status)) || typeof item.updated_at !== "string") throw videoReviewDataInvalid();
    return { scene_number: number, status: item.status as StoredReview["status"], updated_at: item.updated_at };
  });
  if (new Set(reviews.map((review) => review.scene_number)).size !== reviews.length) throw videoReviewDataInvalid();
  return reviews;
}

/**
 * Local fake executor for the already-approved submission record. It writes a
 * tiny deterministic MP4-shaped placeholder sequentially, never imports a
 * provider, invokes a subprocess, or downloads media.
 */
@Injectable()
export class LocalVideoWorkflowService implements OnModuleDestroy {
  private readonly stoppedJobs = new Set<string>();
  private readonly activeTimers = new Map<string, NodeJS.Timeout>();
  private readonly advancing = new Set<string>();

  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: RunwayBudget,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.activeTimers.values()) clearInterval(timer);
    this.activeTimers.clear();
  }

  private videoDirectory(projectId: string): string { return path.join(this.projectsRoot, projectId, "videos", "runway"); }
  private reviewFile(projectId: string): string { return path.join(this.projectsRoot, projectId, "generated_video_reviews.json"); }
  private file(projectId: string, scene: SceneNumber): string { return path.join(this.videoDirectory(projectId), `scene${scene}.mp4`); }

  // Never keyed by jobId: a scene's video always lives at this canonical path
  // regardless of which job produced it, so a project stuck without a
  // matching job record (see legacy video-job adoption gap) can still be
  // previewed once its file exists.
  async content(projectId: string, rawSceneNumber: string): Promise<{ path: string }> {
    const project = await this.projects.findById(projectId.trim());
    const number = sceneNumberFromParam(rawSceneNumber);
    if (!number) throw videoContentUnavailable();
    const file = this.file(project.project_id, number);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size <= 0) throw new Error("invalid");
    } catch {
      throw videoContentUnavailable();
    }
    return { path: file };
  }

  private records(project: StoredProject, jobId: string): VideoRecord[] {
    const normalized = project.video_generation_records.map(normalizeRecord).filter((record): record is VideoRecord => record !== undefined);
    const matching = jobId === LEGACY_VIDEO_JOB_ID
      ? normalized.filter((record) => record.job_id === undefined)
      : normalized.filter((record) => record.job_id === jobId);
    const records = matching.sort((a, b) => a.scene_number - b.scene_number);
    if (records.length !== 6 || records.some((record, index) => record.scene_number !== SCENES[index])) throw videoJobNotFound();
    return records;
  }

  private progress(project: StoredProject, jobId: string): GenerationProgressResponse {
    const records = this.records(project, jobId);
    const completedSceneNumbers = records.filter((record) => record.status === "succeeded").map((record) => record.scene_number);
    const failedSceneNumbers = records.filter((record) => record.status === "failed").map((record) => record.scene_number);
    const current = records.find((record) => record.status === "running")?.scene_number;
    const status = project.workflow_state === WorkflowState.Interrupted ? "interrupted"
      : failedSceneNumbers.length > 0 ? "failed"
      : completedSceneNumbers.length === 6 ? "succeeded"
        : current ? "running" : "created";
    return { jobId, status, ...(current ? { currentSceneNumber: current } : {}), completedSceneNumbers, failedSceneNumbers };
  }

  private replaceRecords(project: StoredProject, replacements: VideoRecord[]): StoredProject {
    const keyOf = (record: VideoRecord) => `${record.job_id ?? LEGACY_VIDEO_JOB_ID}:${record.scene_number}`;
    const keys = new Set(replacements.map(keyOf));
    const kept = project.video_generation_records.filter((item) => {
      const normalized = normalizeRecord(item);
      return !normalized || !keys.has(keyOf(normalized));
    });
    return { ...project, video_generation_records: [...kept, ...replacements] };
  }

  private scheduleTimer(projectId: string, jobId: string): void {
    if (this.activeTimers.has(jobId)) return;
    const timer = setInterval(() => {
      void this.projects.findById(projectId).then((project) => this.advanceReal(project, jobId)).catch(() => undefined);
    }, RUNWAY_POLL_INTERVAL_SECONDS * 1000);
    if (typeof timer.unref === "function") timer.unref();
    this.activeTimers.set(jobId, timer);
  }

  private clearTimer(jobId: string): void {
    const timer = this.activeTimers.get(jobId);
    if (timer) { clearInterval(timer); this.activeTimers.delete(jobId); }
  }

  private async runwayInputForScene(project: StoredProject, jobId: string, scene: SceneNumber) {
    const record = this.records(project, jobId).find((item) => item.scene_number === scene)!;
    const imageBytes = await fs.readFile(project.generated_images[scene - 1]!);
    return {
      imageBytes, imageMimeType: "image/png",
      prompt: String(record.prompt), model: String(record.model), ratio: String(record.ratio),
      durationSeconds: Number(record.duration_seconds),
    };
  }

  /** Guards against a timer tick and a concurrent GET poll both trying to advance the same job at once. */
  private async advanceReal(project: StoredProject, jobId: string): Promise<StoredProject> {
    if (this.advancing.has(jobId)) return project;
    this.advancing.add(jobId);
    try { return await this.advanceRealCore(project, jobId); }
    finally { this.advancing.delete(jobId); }
  }

  private async advanceRealCore(project: StoredProject, jobId: string): Promise<StoredProject> {
    const records = this.records(project, jobId);
    if (records[0]!.execution_mode !== "runway") return project;
    if (project.workflow_state !== WorkflowState.GeneratingVideos) return project;
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("runway") : null;
    if (!apiKey || !this.budget) return project;

    const states: RunwaySceneState[] = records.map((record) => ({
      sceneNumber: record.scene_number,
      status: record.status === "interrupted" ? "failed" : record.status,
      taskId: record.runway_task_id,
      submittedAt: record.runway_submitted_at,
      lastCheckedAt: record.runway_last_checked_at,
    }));

    let result: RunwayAdvanceResult;
    try {
      result = await advanceRunwayScene(states, (scene) => this.runwayInputForScene(project, jobId, scene), {
        apiSecret: apiKey, projectId: project.project_id, apiType: "video",
        estimatedCostPerSceneUsd: VIDEO_SCENE_ESTIMATED_COST_USD, budget: this.budget,
      });
    } catch (error) {
      if (error instanceof RunwayBudgetExceededError) {
        const created = records.find((record) => record.status === "created");
        if (!created) return project;
        const updated = this.replaceRecords(project, [{ ...created, status: "failed", error: "budget_exceeded" }]);
        updated.updated_at = new Date().toISOString();
        await this.projects.save(updated).catch(() => undefined);
        this.clearTimer(jobId);
        return updated;
      }
      throw error;
    }
    return this.applyRunwayAdvance(project, jobId, result);
  }

  private async applyRunwayAdvance(project: StoredProject, jobId: string, result: RunwayAdvanceResult): Promise<StoredProject> {
    const nowIso = new Date().toISOString();
    if (result.kind === "unchanged" || result.kind === "check-error") return project;
    const record = this.records(project, jobId).find((item) => item.scene_number === result.sceneNumber)!;

    if (result.kind === "still-running") {
      const updated = this.replaceRecords(project, [{ ...record, runway_last_checked_at: nowIso }]);
      updated.updated_at = nowIso;
      await this.projects.save(updated);
      return updated;
    }
    if (result.kind === "submitted") {
      const updated = this.replaceRecords(project, [{
        ...record, status: "running", runway_task_id: result.taskId,
        runway_submitted_at: result.submittedAt, runway_last_checked_at: result.submittedAt,
      }]);
      updated.updated_at = nowIso;
      await this.projects.save(updated);
      this.scheduleTimer(project.project_id, jobId);
      return updated;
    }
    if (result.kind === "failed") {
      const updated = this.replaceRecords(project, [{ ...record, status: "failed", error: result.error }]);
      updated.updated_at = nowIso;
      await this.projects.save(updated);
      this.clearTimer(jobId);
      return updated;
    }
    // result.kind === "succeeded"
    await fs.mkdir(this.videoDirectory(project.project_id), { recursive: true });
    await this.atomicBinary(this.file(project.project_id, result.sceneNumber), result.bytes);
    const succeededRecord: VideoRecord = { ...record, status: "succeeded", output_path: this.file(project.project_id, result.sceneNumber), completed_at: nowIso };
    const updated = this.replaceRecords(project, [succeededRecord]);
    const paths = [...updated.generated_video_paths]; while (paths.length < 6) paths.push("");
    paths[result.sceneNumber - 1] = this.file(project.project_id, result.sceneNumber);
    updated.generated_video_paths = paths; updated.updated_at = nowIso;

    if (this.records(updated, jobId).every((item) => item.status === "succeeded")) {
      updated.workflow_state = WorkflowState.ReviewingVideos;
      await this.projects.save(updated);
      this.clearTimer(jobId);
      return updated;
    }
    await this.projects.save(updated);
    // Immediately try to submit the next scene within this same call/timer-tick, so completion is never gated
    // solely on the next external poll or timer interval.
    return this.advanceRealCore(updated, jobId);
  }

  private async atomicBinary(finalPath: string, bytes: Buffer): Promise<void> {
    const temporary = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${crypto.randomUUID()}.tmp`);
    let renamed = false;
    try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, finalPath); renamed = true; }
    finally { if (!renamed) await fs.unlink(temporary).catch(() => undefined); }
  }

  private async hasCompletedFile(projectId: string, scene: SceneNumber): Promise<boolean> {
    try { return (await fs.stat(this.file(projectId, scene))).size > 0; } catch { return false; }
  }

  private async loadReviews(projectId: string): Promise<StoredReview[]> {
    try { return parseReviews(JSON.parse(await fs.readFile(this.reviewFile(projectId), "utf8"))); }
    catch (error) {
      if (isObject(error) && error.code === "ENOENT") return [];
      if (error instanceof Error && "response" in error) throw error;
      throw videoStorageError();
    }
  }

  private toReviews(reviews: StoredReview[], timestamp: string): VideoReview[] {
    return SCENES.map((scene) => {
      const review = reviews.find((item) => item.scene_number === scene);
      return { sceneNumber: scene, status: review?.status ?? "pending", updatedAt: review?.updated_at ?? timestamp };
    });
  }

  async getProgress(projectId: string, jobId: string): Promise<GenerationProgressResponse> {
    let project = await this.projects.findById(projectId.trim());
    const records = this.records(project, jobId);
    if (records[0]!.execution_mode === "runway" && project.workflow_state === WorkflowState.GeneratingVideos) {
      project = await this.advanceReal(project, jobId);
      this.scheduleTimer(project.project_id, jobId);
    }
    return this.progress(project, jobId);
  }

  async stop(projectId: string, jobId: string): Promise<GenerationProgressResponse> {
    const project = await this.projects.findById(projectId.trim());
    this.records(project, jobId);
    if (project.workflow_state !== WorkflowState.GeneratingVideos) throw videoWorkflowNotAllowed();
    this.stoppedJobs.add(jobId);
    this.clearTimer(jobId);
    const timestamp = new Date().toISOString();
    const updated = { ...project, workflow_state: WorkflowState.Interrupted, updated_at: timestamp };
    try { await this.projects.save(updated); } catch { throw videoStorageError(); }
    return this.progress(updated, jobId);
  }

  async run(projectId: string, jobId: string, scenes: readonly SceneNumber[] = SCENES): Promise<GenerationProgressResponse> {
    let project = await this.projects.findById(projectId.trim());
    const initialRecords = this.records(project, jobId);
    if (project.workflow_state !== WorkflowState.GeneratingVideos) throw videoWorkflowNotAllowed();
    this.stoppedJobs.delete(jobId);

    if (initialRecords[0]!.execution_mode === "runway") {
      project = await this.advanceReal(project, jobId);
      this.scheduleTimer(project.project_id, jobId);
      return this.progress(project, jobId);
    }

    for (const scene of scenes) {
      project = await this.projects.findById(projectId.trim());
      if (this.stoppedJobs.has(jobId) || project.workflow_state !== WorkflowState.GeneratingVideos) return this.progress(project, jobId);
      const record = this.records(project, jobId).find((item) => item.scene_number === scene)!;
      if (record.status === "succeeded" && await this.hasCompletedFile(project.project_id, scene)) continue;
      const running: VideoRecord = { ...record, status: "running" };
      project = this.replaceRecords(project, [running]);
      project.updated_at = new Date().toISOString();
      try { await this.projects.save(project); await fs.mkdir(this.videoDirectory(project.project_id), { recursive: true }); await this.atomicBinary(this.file(project.project_id, scene), LOCAL_FAKE_MP4); }
      catch {
        const interrupted = this.replaceRecords(project, [{ ...running, status: "interrupted" }]);
        interrupted.workflow_state = WorkflowState.Interrupted; interrupted.updated_at = new Date().toISOString();
        await this.projects.save(interrupted).catch(() => undefined);
        throw videoStorageError();
      }
      const succeeded = this.replaceRecords(project, [{ ...running, status: "succeeded", output_path: this.file(project.project_id, scene), completed_at: new Date().toISOString() }]);
      const paths = [...succeeded.generated_video_paths]; while (paths.length < 6) paths.push(""); paths[scene - 1] = this.file(project.project_id, scene); succeeded.generated_video_paths = paths;
      succeeded.updated_at = new Date().toISOString(); await this.projects.save(succeeded); project = succeeded;
    }
    const records = this.records(project, jobId);
    if (records.every((record) => record.status === "succeeded") && await Promise.all(SCENES.map((scene) => this.hasCompletedFile(project.project_id, scene))).then((items) => items.every(Boolean))) {
      const completed = { ...project, workflow_state: WorkflowState.ReviewingVideos, updated_at: new Date().toISOString() };
      await this.projects.save(completed); return this.progress(completed, jobId);
    }
    return this.progress(project, jobId);
  }

  async restart(projectId: string, jobId: string): Promise<GenerationProgressResponse> {
    const project = await this.projects.findById(projectId.trim()); this.records(project, jobId);
    if (project.workflow_state !== WorkflowState.Interrupted) throw videoWorkflowNotAllowed();
    const resumed = { ...project, workflow_state: WorkflowState.GeneratingVideos, updated_at: new Date().toISOString() };
    try { await this.projects.save(resumed); } catch { throw videoStorageError(); }
    return this.run(resumed.project_id, jobId);
  }

  private async archive(projectId: string, scene: SceneNumber): Promise<void> {
    const current = this.file(projectId, scene); if (!await this.hasCompletedFile(projectId, scene)) return;
    const history = path.join(this.projectsRoot, projectId, "videos", "history"); await fs.mkdir(history, { recursive: true });
    const entries = await fs.readdir(history); const versions = entries.map((name) => new RegExp(`^scene${scene}_v(\\d{3})\\.mp4$`).exec(name)).filter((match): match is RegExpExecArray => !!match).map((match) => Number(match[1]));
    await this.atomicBinary(path.join(history, `scene${scene}_v${String((versions.length ? Math.max(...versions) : 0) + 1).padStart(3, "0")}.mp4`), await fs.readFile(current));
  }

  async regenerate(projectId: string, jobId: string, selected: readonly SceneNumber[]): Promise<RegenerateVideoResponse> {
    if (!selected.length || new Set(selected).size !== selected.length) throw invalidVideoWorkflowRequest();
    const project = await this.projects.findById(projectId.trim()); const records = this.records(project, jobId);
    const allowedTerminalState = [WorkflowState.ReviewingVideos, WorkflowState.VideosReady, WorkflowState.VideosApproved].includes(project.workflow_state as WorkflowState);
    const allowedFailedRetry = project.workflow_state === WorkflowState.GeneratingVideos
      && selected.every((scene) => records.find((record) => record.scene_number === scene)?.status === "failed");
    if (!allowedTerminalState && !allowedFailedRetry) throw videoWorkflowNotAllowed();
    try { for (const scene of selected) await this.archive(project.project_id, scene); } catch { throw videoStorageError(); }
    const reset = records.filter((record) => selected.includes(record.scene_number)).map((record) => ({
      ...record, status: "created" as const,
      runway_task_id: undefined, runway_submitted_at: undefined, runway_last_checked_at: undefined, error: undefined,
    }));
    const updated = this.replaceRecords(project, reset); updated.workflow_state = WorkflowState.GeneratingVideos; updated.updated_at = new Date().toISOString();
    const paths = [...updated.generated_video_paths]; for (const scene of selected) paths[scene - 1] = ""; updated.generated_video_paths = paths;
    const reviews = (await this.loadReviews(project.project_id)).filter((review) => !selected.includes(review.scene_number));
    try { await atomicWriteUtf8File(this.reviewFile(project.project_id), JSON.stringify(reviews, null, 2)); await this.projects.save(updated); } catch { throw videoStorageError(); }
    const result = await this.run(project.project_id, jobId, selected);
    return { ...result, regeneratedSceneNumbers: [...selected] };
  }

  async getReview(projectId: string, jobId: string): Promise<GetVideoReviewResponse> {
    const project = await this.projects.findById(projectId.trim()); this.records(project, jobId);
    if (![WorkflowState.ReviewingVideos, WorkflowState.VideosReady, WorkflowState.VideosApproved].includes(project.workflow_state as WorkflowState)) throw videoWorkflowNotAllowed();
    if (!(await Promise.all(SCENES.map((scene) => this.hasCompletedFile(project.project_id, scene)))).every(Boolean)) throw videoWorkflowNotAllowed();
    const reviews = await this.loadReviews(project.project_id); return { project: toApiProject(project), reviews: this.toReviews(reviews, project.updated_at) };
  }

  async approveReview(projectId: string, jobId: string, rawScene: string, body: unknown): Promise<ApproveVideoReviewResponse> {
    if (!isObject(body) || Object.keys(body).length !== 1 || body.approved !== true) throw invalidVideoWorkflowRequest();
    const scene = sceneNumber(Number(rawScene)); if (!scene || String(scene) !== rawScene) throw invalidVideoWorkflowRequest();
    await this.getReview(projectId, jobId); const project = await this.projects.findById(projectId.trim());
    const timestamp = new Date().toISOString(); const reviews = (await this.loadReviews(project.project_id)).filter((item) => item.scene_number !== scene);
    reviews.push({ scene_number: scene, status: "approved", updated_at: timestamp });
    const allApproved = SCENES.every((number) => reviews.some((review) => review.scene_number === number && review.status === "approved"));
    const updated = { ...project, workflow_state: allApproved ? WorkflowState.VideosApproved : WorkflowState.ReviewingVideos, updated_at: timestamp };
    try { await atomicWriteUtf8File(this.reviewFile(project.project_id), JSON.stringify(reviews.sort((a, b) => a.scene_number - b.scene_number), null, 2)); await this.projects.save(updated); }
    catch { throw videoStorageError(); }
    return { project: toApiProject(updated), reviews: this.toReviews(reviews, timestamp) };
  }
}
