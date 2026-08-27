import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { isSceneNumber, sceneNumbersFor, type LongEpisodeDetail, type LongEpisodeStatus, type MergeLongEpisodeVideosResponse, type SceneNumber } from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { FfmpegMergeEngine, MediaToolError, type MediaCommandRunner, type MergeSceneInput } from "../videos/ffmpeg-merge.service.js";
import { longEpisodeFfmpegUnavailable, longEpisodeMergeClipsInvalid, longEpisodeMergeFailed, longEpisodeMergeNotAllowed, longEpisodeNotFound, longInvalidData, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";
import { LongProjectsService } from "./long-projects.service.js";

const FINAL_PATH = "videos/final/instagram_reel.mp4" as const;
const statuses: readonly LongEpisodeStatus[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed", "failed"];
type ObjectMap = Record<string, unknown>;
type Episode = ObjectMap & { number: number; state: LongEpisodeStatus; approved: boolean; script: ObjectMap; script_revision: number; updated_at: string; scene_count?: number; duration_seconds?: number };
type Review = { scene_number: SceneNumber; status: "pending" | "approved"; updated_at: string };
type VideoRecord = { scene_number: SceneNumber; job_id: string; status: "created" | "running" | "succeeded" | "interrupted" | "failed"; execution_mode: "local_fake_no_provider" | "runway" };

const object = (value: unknown): value is ObjectMap => Boolean(value) && typeof value === "object" && !Array.isArray(value);
// Format-only check (1..MAX_SCENE_COUNT) — bounded to a specific episode's own scene_count separately (see
// approvedClips()'s sceneCount()-derived length/set checks below).
const scene = (value: unknown): value is SceneNumber => Number.isInteger(value) && isSceneNumber(value as number);

/** Episode-scoped final rendering; its injectable runner keeps tests provider-free. */
@Injectable()
export class EpisodeVideoMergeService {
  private readonly engine: FfmpegMergeEngine;
  private readonly projects: LongProjectsService;

  constructor(private readonly projectsRoot: string, runner?: MediaCommandRunner) { this.engine = new FfmpegMergeEngine(runner); this.projects = new LongProjectsService(projectsRoot); }

  private files(id: string, number: number) {
    const root = longStoryRoot(this.projectsRoot, id);
    const episode = path.join(root, episodeDirectoryName(number));
    const videos = path.join(episode, "videos");
    return { root, outlines: path.join(root, "episode_outlines.json"), longProject: path.join(root, "project.json"), episode, project: path.join(episode, "project.json"), videos, records: path.join(episode, "video_generation_records.json"), reviews: path.join(episode, "generated_video_reviews.json") };
  }

  private async json(file: string): Promise<unknown> {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); }
  }

  private async loadEpisode(id: string, number: number): Promise<Episode> {
    if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound();
    const f = this.files(id, number); const outlines = await this.json(f.outlines);
    if (!Array.isArray(outlines) || number > outlines.length || !object(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound();
    const raw = await this.json(f.project);
    if (!object(raw) || raw.number !== number || !statuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !object(raw.script) || !Number.isInteger(raw.script_revision) || typeof raw.updated_at !== "string") throw longInvalidData();
    return raw as Episode;
  }

  private detail(episode: Episode): LongEpisodeDetail {
    const script = toApiEpisodeScript(episode.script);
    const warnings = withoutStaleEpisodeRecoveryWarnings(Array.isArray(episode.warnings) ? episode.warnings.filter((item): item is string => typeof item === "string") : [], episode.state);
    return { episodeNumber: episode.number, title: String(episode.title), summary: String(episode.summary), mainEvent: String(episode.core_event), conflict: String(episode.conflict), cliffhanger: String(episode.cliffhanger), nextEpisodeHook: String(episode.next_connection), status: episode.state, approved: episode.approved, scriptRevision: episode.script_revision, ...(script ? { script } : {}), scriptHistoryCount: Array.isArray(episode.script_history) ? episode.script_history.length : 0, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  private async saveEpisode(id: string, number: number, episode: Episode): Promise<void> {
    const f = this.files(id, number); const outlines = await this.json(f.outlines);
    if (!Array.isArray(outlines) || !object(outlines[number - 1])) throw longInvalidData();
    const copy = [...outlines]; copy[number - 1] = { ...copy[number - 1], status: episode.state };
    try { await atomicWriteUtf8File(f.project, JSON.stringify(episode, null, 2)); await atomicWriteUtf8File(f.outlines, JSON.stringify(copy, null, 2)); }
    catch { throw longStorageError(); }
  }

  private clip(id: string, number: number, value: SceneNumber): string { return path.join(this.files(id, number).videos, `scene${value}.mp4`); }
  private final(id: string, number: number): string { return path.join(this.files(id, number).videos, "final", "instagram_reel.mp4"); }
  /** Same path scheme as episode-narration.service.ts's narrationPath() — not shared to avoid a cross-service dependency, matching this file's existing "each service computes its own file paths" convention. */
  private narrationAudio(id: string, number: number, scene: SceneNumber): string { return path.join(this.files(id, number).episode, "narration", `scene${scene}.mp3`); }
  /** Falls back to 6, matching every Episode stored before scene_count existed (see episode-scripts.service.ts's parseStored). */
  private sceneCount(episode: Episode): number { return Number.isInteger(episode.scene_count) ? episode.scene_count as number : 6; }
  /** Total episode duration_seconds divided by its own scene count — same derivation as episode-videos.service.ts's durationSecondsPerScene(). */
  private clipDurationSeconds(episode: Episode): 5 | 10 { return Number(episode.duration_seconds) / this.sceneCount(episode) >= 7.5 ? 10 : 5; }

  private async approvedClips(id: string, number: number, episode: Episode): Promise<string[]> {
    // `failed` is reachable from exactly one place — a merge that did not finish — and a merge that did not
    // finish published nothing. So it is a state to try again from, not a state to be stuck in. Without
    // this the app tells the person their approved scenes are still there and to try again, and then
    // refuses; the paid work behind those scenes stays reachable only by editing a file by hand.
    if (episode.state !== "videos_approved" && episode.state !== "failed") throw longEpisodeMergeNotAllowed();
    const sceneNumbers = sceneNumbersFor(this.sceneCount(episode));
    const [rawReviews, rawRecords] = await Promise.all([this.json(this.files(id, number).reviews).catch(() => { throw longEpisodeMergeClipsInvalid(); }), this.json(this.files(id, number).records).catch(() => { throw longEpisodeMergeClipsInvalid(); })]);
    if (!Array.isArray(rawReviews) || rawReviews.length !== sceneNumbers.length || !rawReviews.every((item) => object(item) && scene(item.scene_number) && item.status === "approved" && typeof item.updated_at === "string") || new Set(rawReviews.map((item) => (item as Review).scene_number)).size !== sceneNumbers.length) throw longEpisodeMergeClipsInvalid();
    if (!Array.isArray(rawRecords) || rawRecords.length !== sceneNumbers.length || !rawRecords.every((item) => object(item) && scene(item.scene_number) && typeof item.job_id === "string" && item.job_id.length > 0 && item.status === "succeeded" && (item.execution_mode === "local_fake_no_provider" || item.execution_mode === "runway")) || new Set(rawRecords.map((item) => (item as VideoRecord).scene_number)).size !== sceneNumbers.length || new Set(rawRecords.map((item) => (item as VideoRecord).job_id)).size !== 1) throw longEpisodeMergeClipsInvalid();
    const clips = sceneNumbers.map((number_) => this.clip(id, number, number_));
    try { await Promise.all(clips.map(async (file) => { if ((await fs.stat(file)).size <= 0) throw new Error("empty"); })); }
    catch { throw longEpisodeMergeClipsInvalid(); }
    return clips;
  }

  /**
   * Exactly the same gating as video-merge.service.ts's identical mergeScenes() (see that doc comment for the
   * full reasoning) — narrationAudioPath is gated on narrationEnabled AND file existence/validity (a stale or
   * toggled-off file must never fail the merge, it just falls back to silence for that scene); subtitleText is
   * independent, gated on subtitlesEnabled AND that scene having narration text, regardless of audio existence.
   */
  private async mergeScenes(id: string, number: number, episode: Episode, clips: readonly string[], sceneNumbers: readonly SceneNumber[]): Promise<MergeSceneInput[]> {
    const projectSettings = (await this.projects.get(id)).project.settings;
    const scenes = episode.script.scenes;
    const scriptScenes = Array.isArray(scenes) ? scenes : [];
    return Promise.all(sceneNumbers.map(async (sceneNumber, index) => {
      const scene = scriptScenes[index];
      const narrationText = object(scene) && typeof scene.narration === "string" ? scene.narration.trim() : "";
      const file = this.narrationAudio(id, number, sceneNumber);
      const narrationAudioPath = projectSettings.narrationEnabled && (await fs.stat(file).then((stat) => stat.size > 0).catch(() => false)) ? file : null;
      const subtitleText = projectSettings.subtitlesEnabled ? (narrationText || null) : null;
      return { clip: clips[index]!, narrationAudioPath, subtitleText };
    }));
  }

  private async ratio(id: string, number: number): Promise<"9:16" | "16:9"> {
    const raw = await this.json(this.files(id, number).longProject);
    if (!object(raw) || (raw.aspect_ratio !== "9:16" && raw.aspect_ratio !== "16:9")) throw longInvalidData();
    return raw.aspect_ratio;
  }

  private async fail(id: string, number: number, episode: Episode): Promise<void> {
    const failed = { ...episode, state: "failed" as const, updated_at: new Date().toISOString(), errors: [...(Array.isArray(episode.errors) ? episode.errors : []), "Episode video rendering failed."] };
    await this.saveEpisode(id, number, failed).catch(() => undefined);
  }

  async merge(projectId: string, number: number): Promise<MergeLongEpisodeVideosResponse> {
    const id = projectId.trim(); const episode = await this.loadEpisode(id, number); const clips = await this.approvedClips(id, number, episode);
    try { for (const clip of clips) await this.engine.probe(clip); }
    catch (error) { if (error instanceof MediaToolError && error.kind === "unavailable") throw longEpisodeFfmpegUnavailable(); throw longEpisodeMergeClipsInvalid(); }
    const rendering = { ...episode, state: "rendering" as const, updated_at: new Date().toISOString() };
    await this.saveEpisode(id, number, rendering);
    try {
      const output = this.final(id, number); await fs.mkdir(path.dirname(output), { recursive: true });
      const mergeScenes = await this.mergeScenes(id, number, episode, clips, sceneNumbersFor(this.sceneCount(episode)));
      await this.engine.merge(mergeScenes, this.clipDurationSeconds(episode), output, await this.ratio(id, number));
      const completed = { ...rendering, state: "completed" as const, updated_at: new Date().toISOString(), final_video_path: FINAL_PATH };
      await this.saveEpisode(id, number, completed);
      return { episode: this.detail(completed), finalVideoPath: FINAL_PATH };
    } catch (error) {
      await this.fail(id, number, rendering);
      if (error instanceof MediaToolError && error.kind === "unavailable") throw longEpisodeFfmpegUnavailable();
      throw longEpisodeMergeFailed();
    }
  }
}
