import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, WorkflowState, type MergeVideosResponse, type SceneNumber } from "@ai-animation-studio/shared";

import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { sceneValue } from "../images/image-prompt.js";
import { FfmpegMergeEngine, MediaToolError, type MediaCommandRunner, type MergeSceneInput } from "./ffmpeg-merge.service.js";
import { ffmpegUnavailable, videoMergeClipsInvalid, videoMergeContentUnavailable, videoMergeFailed, videoMergeNotAllowed, videoMergeStorageError } from "./video-merge-api.error.js";

const FINAL_VIDEO_PATH = "videos/final/instagram_reel.mp4" as const;
type StoredReview = { scene_number: SceneNumber; status: "pending" | "approved" };

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}

function isApprovedReviews(value: unknown, scenes: readonly SceneNumber[]): value is StoredReview[] {
  return Array.isArray(value) && value.length === scenes.length && value.every((item) => typeof item === "object" && item !== null
    && scenes.includes((item as { scene_number?: unknown }).scene_number as SceneNumber)
    && (item as { status?: unknown }).status === "approved")
    && new Set(value.map((item) => item.scene_number)).size === scenes.length;
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

  /**
   * A narration file that is missing, empty, or was recorded under a path this machine no longer resolves to
   * (see image-review.service.ts's identical caution about stale generated_images entries) must never fail the
   * merge — narration is supplementary, the video is not. Any such scene simply falls back to silence.
   *
   * subtitleText is independent of narrationAudioPath (subtitles-only, no TTS spend, is a deliberate mode — see
   * ShortProjectSettings.subtitlesEnabled's doc comment): a scene gets a subtitle whenever subtitlesEnabled is on
   * AND that scene has narration text, regardless of whether narration audio exists for it.
   */
  private async mergeScenes(project: StoredProject, clips: readonly string[], scenes: readonly SceneNumber[]): Promise<MergeSceneInput[]> {
    const subtitlesEnabled = toShortProjectSettings(project).subtitlesEnabled;
    return Promise.all(scenes.map(async (scene, index) => {
      const file = project.generated_narrations[scene - 1];
      const narrationAudioPath = typeof file === "string" && (await fs.stat(file).then((stat) => stat.size > 0).catch(() => false)) ? file : null;
      const subtitleText = subtitlesEnabled ? sceneValue(project.scenes[scene - 1], "narration") || null : null;
      return { clip: clips[index]!, narrationAudioPath, subtitleText };
    }));
  }

  async content(projectId: string): Promise<{ path: string }> {
    const project = await this.projects.findById(projectId.trim());
    const file = this.final(project.project_id);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size <= 0) throw new Error("invalid");
    } catch {
      throw videoMergeContentUnavailable();
    }
    return { path: file };
  }

  private async approvedClips(project: StoredProject): Promise<string[]> {
    if (project.workflow_state !== WorkflowState.VideosApproved) throw videoMergeNotAllowed();
    let reviews: unknown;
    try { reviews = JSON.parse(await fs.readFile(path.join(this.projectDirectory(project.project_id), "generated_video_reviews.json"), "utf8")); }
    catch { throw videoMergeClipsInvalid(); }
    const scenes = scenesFor(project);
    if (!isApprovedReviews(reviews, scenes)) throw videoMergeClipsInvalid();
    const clips = scenes.map((scene) => this.clip(project.project_id, scene));
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
    const mergeScenes = await this.mergeScenes(project, clips, scenesFor(project));
    const clipDurationSeconds = toShortProjectSettings(project).clipDurationSeconds;
    const rendering = { ...project, workflow_state: WorkflowState.Rendering, updated_at: new Date().toISOString() };
    try { await this.projects.save(rendering); } catch { throw videoMergeStorageError(); }
    try {
      await fs.mkdir(path.dirname(this.final(project.project_id)), { recursive: true });
      await this.engine.merge(mergeScenes, clipDurationSeconds, this.final(project.project_id), rendering.style_profile.aspect);
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
