import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, WorkflowState, type MergeVideosResponse, type SceneNumber } from "@ai-animation-studio/shared";

import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject, StoredUsedAudio } from "../projects/project-storage.schema.js";
import { sceneValue } from "../images/image-prompt.js";
import { AudioLibraryService } from "../audio/audio-library.service.js";
import { FfmpegMergeEngine, MediaToolError, type MediaCommandRunner, type MergeSceneInput } from "./ffmpeg-merge.service.js";
import { ffmpegUnavailable, videoMergeClipsInvalid, videoMergeContentUnavailable, videoMergeFailed, videoMergeInvalidRequest, videoMergeNotAllowed, videoMergeStorageError } from "./video-merge-api.error.js";

const FINAL_VIDEO_PATH = "videos/final/instagram_reel.mp4" as const;
const DEFAULT_BGM_VOLUME = 0.25;
const DEFAULT_BGM_FADE_SECONDS = 2;
type StoredReview = { scene_number: SceneNumber; status: "pending" | "approved" };
type AudioMode = "narration" | "narration+bgm" | "silent";
interface ResolvedAudioSettings { mode: AudioMode; trackId?: string; volume: number; fadeSeconds: number }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}

function isApprovedReviews(value: unknown, scenes: readonly SceneNumber[]): value is StoredReview[] {
  return Array.isArray(value) && value.length === scenes.length && value.every((item) => typeof item === "object" && item !== null
    && scenes.includes((item as { scene_number?: unknown }).scene_number as SceneNumber)
    && (item as { status?: unknown }).status === "approved")
    && new Set(value.map((item) => item.scene_number)).size === scenes.length;
}

/** Same "real files exist" meaning as project.mapper.ts's narrationAvailableFor() — kept as its own copy per this codebase's convention (see that function's own doc comment for why a projects/ -> videos/ layering inversion is avoided by not importing it). */
function narrationAvailableFor(project: StoredProject): boolean {
  return project.generated_narrations.some((file) => typeof file === "string" && file.length > 0);
}

/**
 * `request` is the raw, unvalidated POST body. Omitted (or `audio` omitted within it) falls back to
 * narrationEnabled's own on/off (matching this function's pre-audio.mode behavior exactly — "off" means "don't
 * use it" even if old narration files are still on disk, the same as this file's mergeScenes() doc comment
 * already established for subtitlesEnabled) gated by whether narration actually exists at all. An *explicit*
 * `audio.mode: "narration"` request is different: it only requires narrationAvailable (real files exist), not
 * the toggle — a caller asking for narration by name is overriding the project-level default for this one
 * merge, the same way audio.mode is allowed to override it toward "silent" too.
 *
 * "narration" and "narration+bgm" both require real narration audio to exist; requesting either without it is
 * rejected rather than silently falling back, so a client bug can't ship a merge whose audio doesn't match what
 * the user asked for.
 */
function resolveAudioSettings(project: StoredProject, request: unknown): ResolvedAudioSettings {
  const narrationAvailable = narrationAvailableFor(project);
  const defaultMode: AudioMode = narrationAvailable && toShortProjectSettings(project).narrationEnabled ? "narration" : "silent";
  const fallback: ResolvedAudioSettings = { mode: defaultMode, volume: DEFAULT_BGM_VOLUME, fadeSeconds: DEFAULT_BGM_FADE_SECONDS };
  if (request === undefined) return fallback;
  if (!isObject(request) || Object.keys(request).some((key) => key !== "audio")) throw videoMergeInvalidRequest();
  if (request.audio === undefined) return fallback;
  const audio = request.audio;
  if (!isObject(audio) || Object.keys(audio).some((key) => !["mode", "trackId", "volume", "fadeSeconds"].includes(key))) throw videoMergeInvalidRequest();
  if (audio.mode !== "narration" && audio.mode !== "narration+bgm" && audio.mode !== "silent") throw videoMergeInvalidRequest("audio.mode must be narration, narration+bgm, or silent.");
  if ((audio.mode === "narration" || audio.mode === "narration+bgm") && !narrationAvailable) throw videoMergeInvalidRequest("This project has no narration audio to include.");
  if (audio.mode === "narration+bgm" && (typeof audio.trackId !== "string" || !audio.trackId.trim())) throw videoMergeInvalidRequest("audio.trackId is required for narration+bgm.");
  if (audio.trackId !== undefined && typeof audio.trackId !== "string") throw videoMergeInvalidRequest();
  if (audio.volume !== undefined && (typeof audio.volume !== "number" || !Number.isFinite(audio.volume) || audio.volume < 0 || audio.volume > 1)) throw videoMergeInvalidRequest("audio.volume must be between 0 and 1.");
  if (audio.fadeSeconds !== undefined && (typeof audio.fadeSeconds !== "number" || !Number.isFinite(audio.fadeSeconds) || audio.fadeSeconds < 0)) throw videoMergeInvalidRequest("audio.fadeSeconds must be a non-negative number.");
  return {
    mode: audio.mode,
    ...(audio.mode === "narration+bgm" ? { trackId: audio.trackId as string } : {}),
    volume: typeof audio.volume === "number" ? audio.volume : DEFAULT_BGM_VOLUME,
    fadeSeconds: typeof audio.fadeSeconds === "number" ? audio.fadeSeconds : DEFAULT_BGM_FADE_SECONDS,
  };
}

@Injectable()
export class LocalVideoMergeService {
  private readonly engine: FfmpegMergeEngine;

  constructor(private readonly projects: LocalProjectRepository, private readonly projectsRoot: string, runner?: MediaCommandRunner, private readonly audioLibrary?: AudioLibraryService) {
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
   * `includeNarration` is this merge's own resolved audio.mode ("narration"/"narration+bgm" vs "silent") — not
   * ShortProjectSettings.narrationEnabled directly. The two usually agree, but audio.mode is what the user
   * explicitly asked this specific merge to produce (e.g. a deliberate silent export to add music in Instagram
   * itself), so it must be able to override the project-level setting for one merge without changing it.
   *
   * subtitleText is independent of narrationAudioPath (subtitles-only, no TTS spend, is a deliberate mode — see
   * ShortProjectSettings.subtitlesEnabled's doc comment): a scene gets a subtitle whenever subtitlesEnabled is on
   * AND that scene has narration text, regardless of whether narration audio exists for it.
   */
  private async mergeScenes(project: StoredProject, clips: readonly string[], scenes: readonly SceneNumber[], includeNarration: boolean): Promise<MergeSceneInput[]> {
    const settings = toShortProjectSettings(project);
    return Promise.all(scenes.map(async (scene, index) => {
      const file = project.generated_narrations[scene - 1];
      const narrationAudioPath = includeNarration && typeof file === "string" && (await fs.stat(file).then((stat) => stat.size > 0).catch(() => false)) ? file : null;
      const subtitleText = settings.subtitlesEnabled ? sceneValue(project.scenes[scene - 1], "narration") || null : null;
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

  /**
   * Preserves whatever final video already exists before this merge overwrites it — a project only reaches
   * merge() again after a scene-video restore reopens VideosApproved (see video-library.service.ts's restore()),
   * so without this, a user who restores an old scene and re-merges would silently lose the previous final cut
   * (`.claude-bridge` Round 166). Mirrors local-video-workflow.service.ts's private archive(), generalized to the
   * final video's own directory — see video-library.service.ts's historyFileName() for the matching read side.
   */
  private async archiveExistingFinal(projectId: string): Promise<void> {
    const current = this.final(projectId);
    const bytes = await fs.readFile(current).catch(() => undefined);
    if (!bytes || bytes.length === 0) return;
    const history = path.join(this.projectDirectory(projectId), "videos", "final", "history");
    await fs.mkdir(history, { recursive: true });
    const entries = await fs.readdir(history);
    const versions = entries.map((name) => /^instagram_reel_v(\d{3})\.mp4$/.exec(name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1]));
    const next = (versions.length ? Math.max(...versions) : 0) + 1;
    const temporary = path.join(history, `.instagram_reel_v${String(next).padStart(3, "0")}.mp4.tmp`);
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, path.join(history, `instagram_reel_v${String(next).padStart(3, "0")}.mp4`));
  }

  private async saveFailure(project: StoredProject): Promise<void> {
    const updated = { ...project, workflow_state: WorkflowState.Failed, updated_at: new Date().toISOString(), errors: [...project.errors, "Local video rendering failed."] };
    await this.projects.save(updated).catch(() => undefined);
  }

  async merge(projectId: string, request?: unknown): Promise<MergeVideosResponse> {
    const project = await this.projects.findById(projectId.trim());
    const audio = resolveAudioSettings(project, request);
    // Resolved before any state changes or rendering work starts — an unknown/unavailable track should fail
    // fast, the same as approvedClips() failing fast on invalid clips below, not mid-render.
    let bgmPath: string | undefined;
    let bgmAttribution: { attributionRequired: boolean; attributionText?: string } | undefined;
    if (audio.mode === "narration+bgm") {
      if (!this.audioLibrary) throw videoMergeInvalidRequest("BGM is not available in this configuration.");
      bgmPath = (await this.audioLibrary.content(audio.trackId!)).path;
      const track = await this.audioLibrary.get(audio.trackId!);
      bgmAttribution = { attributionRequired: track.attributionRequired, ...(track.attributionText ? { attributionText: track.attributionText } : {}) };
    }
    const clips = await this.approvedClips(project);
    try { for (const clip of clips) await this.engine.probe(clip); }
    catch (error) {
      if (error instanceof MediaToolError && error.kind === "unavailable") throw ffmpegUnavailable();
      throw videoMergeClipsInvalid();
    }
    const mergeScenes = await this.mergeScenes(project, clips, scenesFor(project), audio.mode !== "silent");
    const clipDurationSeconds = toShortProjectSettings(project).clipDurationSeconds;
    const rendering = { ...project, workflow_state: WorkflowState.Rendering, updated_at: new Date().toISOString() };
    try { await this.projects.save(rendering); } catch { throw videoMergeStorageError(); }
    try {
      await this.archiveExistingFinal(project.project_id);
      const finalPath = this.final(project.project_id);
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await this.engine.merge(mergeScenes, clipDurationSeconds, finalPath, rendering.style_profile.aspect);
      if (audio.mode === "narration+bgm" && bgmPath) {
        await this.engine.mixBackgroundMusic(finalPath, bgmPath, audio.volume, audio.fadeSeconds, finalPath);
      }
      const usedAudio: StoredUsedAudio = {
        mode: audio.mode,
        ...(audio.mode === "narration+bgm" ? { track_id: audio.trackId! } : {}),
        ...(bgmAttribution?.attributionRequired !== undefined ? { attribution_required: bgmAttribution.attributionRequired } : {}),
        ...(bgmAttribution?.attributionText !== undefined ? { attribution_text: bgmAttribution.attributionText } : {}),
      };
      const completed = { ...rendering, workflow_state: WorkflowState.Completed, updated_at: new Date().toISOString(), final_video_path: FINAL_VIDEO_PATH, used_audio: usedAudio };
      await this.projects.save(completed);
      return { project: toApiProject(completed), finalVideoPath: FINAL_VIDEO_PATH };
    } catch (error) {
      await this.saveFailure(rendering);
      if (error instanceof MediaToolError && error.kind === "unavailable") throw ffmpegUnavailable();
      throw videoMergeFailed();
    }
  }
}
