import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
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
import {
  invalidVideoWorkflowRequest,
  videoJobNotFound,
  videoReviewDataInvalid,
  videoStorageError,
  videoWorkflowNotAllowed,
} from "./video-workflow-api.error.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const satisfies readonly SceneNumber[];
const LOCAL_FAKE_MP4 = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");

type VideoStatus = "created" | "running" | "succeeded" | "interrupted";
type VideoRecord = Record<string, unknown> & {
  scene_number: SceneNumber; job_id: string; status: VideoStatus; execution_mode: "local_fake_no_provider";
};
type StoredReview = { scene_number: SceneNumber; status: "pending" | "approved"; updated_at: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sceneNumber = (value: unknown): SceneNumber | undefined => typeof value === "number" && Number.isInteger(value) && SCENES.includes(value as SceneNumber) ? value as SceneNumber : undefined;

function isRecord(value: unknown): value is VideoRecord {
  return isObject(value) && !!sceneNumber(value.scene_number) && typeof value.job_id === "string"
    && ["created", "running", "succeeded", "interrupted"].includes(String(value.status))
    && value.execution_mode === "local_fake_no_provider";
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
export class LocalVideoWorkflowService {
  private readonly stoppedJobs = new Set<string>();

  constructor(private readonly projects: LocalProjectRepository, private readonly projectsRoot: string) {}

  private videoDirectory(projectId: string): string { return path.join(this.projectsRoot, projectId, "videos", "runway"); }
  private reviewFile(projectId: string): string { return path.join(this.projectsRoot, projectId, "generated_video_reviews.json"); }
  private file(projectId: string, scene: SceneNumber): string { return path.join(this.videoDirectory(projectId), `scene${scene}.mp4`); }

  private records(project: StoredProject, jobId: string): VideoRecord[] {
    const records = project.video_generation_records.filter(isRecord).filter((record) => record.job_id === jobId).sort((a, b) => a.scene_number - b.scene_number);
    if (records.length !== 6 || records.some((record, index) => record.scene_number !== SCENES[index])) throw videoJobNotFound();
    return records;
  }

  private progress(project: StoredProject, jobId: string): GenerationProgressResponse {
    const records = this.records(project, jobId);
    const completedSceneNumbers = records.filter((record) => record.status === "succeeded").map((record) => record.scene_number);
    const current = records.find((record) => record.status === "running")?.scene_number;
    const status = project.workflow_state === WorkflowState.Interrupted ? "interrupted"
      : completedSceneNumbers.length === 6 ? "succeeded"
        : current ? "running" : "created";
    return { jobId, status, ...(current ? { currentSceneNumber: current } : {}), completedSceneNumbers, failedSceneNumbers: [] };
  }

  private replaceRecords(project: StoredProject, replacements: VideoRecord[]): StoredProject {
    const keys = new Set(replacements.map((record) => `${record.job_id}:${record.scene_number}`));
    return { ...project, video_generation_records: [...project.video_generation_records.filter((item) => !isRecord(item) || !keys.has(`${item.job_id}:${item.scene_number}`)), ...replacements] };
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
    const project = await this.projects.findById(projectId.trim());
    return this.progress(project, jobId);
  }

  async stop(projectId: string, jobId: string): Promise<GenerationProgressResponse> {
    const project = await this.projects.findById(projectId.trim());
    this.records(project, jobId);
    if (project.workflow_state !== WorkflowState.GeneratingVideos) throw videoWorkflowNotAllowed();
    this.stoppedJobs.add(jobId);
    const timestamp = new Date().toISOString();
    const updated = { ...project, workflow_state: WorkflowState.Interrupted, updated_at: timestamp };
    try { await this.projects.save(updated); } catch { throw videoStorageError(); }
    return this.progress(updated, jobId);
  }

  async run(projectId: string, jobId: string, scenes: readonly SceneNumber[] = SCENES): Promise<GenerationProgressResponse> {
    let project = await this.projects.findById(projectId.trim());
    this.records(project, jobId);
    if (project.workflow_state !== WorkflowState.GeneratingVideos) throw videoWorkflowNotAllowed();
    this.stoppedJobs.delete(jobId);
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
    if (![WorkflowState.ReviewingVideos, WorkflowState.VideosReady, WorkflowState.VideosApproved].includes(project.workflow_state as WorkflowState)) throw videoWorkflowNotAllowed();
    try { for (const scene of selected) await this.archive(project.project_id, scene); } catch { throw videoStorageError(); }
    const reset = records.filter((record) => selected.includes(record.scene_number)).map((record) => ({ ...record, status: "created" as const }));
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
