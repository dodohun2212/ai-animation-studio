import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { WorkflowState, type MergeVideosResponse, type SceneNumber } from "@ai-animation-studio/shared";

import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { FfmpegMergeEngine, MediaToolError, type MediaCommandRunner } from "./ffmpeg-merge.service.js";
import { ffmpegUnavailable, videoMergeClipsInvalid, videoMergeFailed, videoMergeNotAllowed, videoMergeStorageError } from "./video-merge-api.error.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const satisfies readonly SceneNumber[];
const FINAL_VIDEO_PATH = "videos/final/instagram_reel.mp4" as const;
type StoredReview = { scene_number: SceneNumber; status: "pending" | "approved" };

function isApprovedReviews(value: unknown): value is StoredReview[] {
  return Array.isArray(value) && value.length === 6 && value.every((item) => typeof item === "object" && item !== null
    && SCENES.includes((item as { scene_number?: unknown }).scene_number as SceneNumber)
    && (item as { status?: unknown }).status === "approved")
    && new Set(value.map((item) => item.scene_number)).size === 6;
}

@Injectable()
export class LocalVideoMergeService {
  private readonly engine: FfmpegMergeEngine;

  constructor(private readonly projects: LocalProjectRepository, private readonly projectsRoot: string, runner?: MediaCommandRunner) {
    this.engine = new FfmpegMergeEngine(runner);
  }

  private projectDirectory(projectId: string): string { return path.join(this.projectsRoot, projectId); }
  private clip(projectId: string, scene: SceneNumber): string { return path.join(this.projectDirectory(projectId), "videos", "runway", `scene${scene}.mp4`); }
  private final(projectId: string): string { return path.join(this.projectDirectory(projectId), FINAL_VIDEO_PATH); }

  private async approvedClips(project: StoredProject): Promise<string[]> {
    if (project.workflow_state !== WorkflowState.VideosApproved) throw videoMergeNotAllowed();
    let reviews: unknown;
    try { reviews = JSON.parse(await fs.readFile(path.join(this.projectDirectory(project.project_id), "generated_video_reviews.json"), "utf8")); }
    catch { throw videoMergeClipsInvalid(); }
    if (!isApprovedReviews(reviews)) throw videoMergeClipsInvalid();
    const clips = SCENES.map((scene) => this.clip(project.project_id, scene));
    try { await Promise.all(clips.map(async (clip) => { if ((await fs.stat(clip)).size <= 0) throw new Error("empty"); })); }
    catch { throw videoMergeClipsInvalid(); }
    return clips;
  }

  private async saveFailure(project: StoredProject): Promise<void> {
    const updated = { ...project, workflow_state: WorkflowState.Failed, updated_at: new Date().toISOString(), errors: [...project.errors, "Local video rendering failed."] };
    await this.projects.save(updated).catch(() => undefined);
  }

  async merge(projectId: string): Promise<MergeVideosResponse> {
    const project = await this.projects.findById(projectId.trim());
    const clips = await this.approvedClips(project);
    try { for (const clip of clips) await this.engine.probe(clip); }
    catch (error) {
      if (error instanceof MediaToolError && error.kind === "unavailable") throw ffmpegUnavailable();
      throw videoMergeClipsInvalid();
    }
    const rendering = { ...project, workflow_state: WorkflowState.Rendering, updated_at: new Date().toISOString() };
    try { await this.projects.save(rendering); } catch { throw videoMergeStorageError(); }
    try {
      await fs.mkdir(path.dirname(this.final(project.project_id)), { recursive: true });
      await this.engine.merge(clips, this.final(project.project_id), rendering.style_profile.aspect);
      const completed = { ...rendering, workflow_state: WorkflowState.Completed, updated_at: new Date().toISOString(), final_video_path: FINAL_VIDEO_PATH };
      await this.projects.save(completed);
      return { project: toApiProject(completed), finalVideoPath: FINAL_VIDEO_PATH };
    } catch (error) {
      await this.saveFailure(rendering);
      if (error instanceof MediaToolError && error.kind === "unavailable") throw ffmpegUnavailable();
      throw videoMergeFailed();
    }
  }
}
