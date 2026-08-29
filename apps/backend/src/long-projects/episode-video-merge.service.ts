import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { LONG_EPISODE_STATUSES, isSceneNumber, sceneNumbersFor, type LongEpisodeDetail, type LongEpisodeStatus, type MergeLongEpisodeVideosResponse, type SceneNumber } from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { FfmpegMergeEngine, MediaToolError, type MediaCommandRunner, type MergeSceneInput } from "../videos/ffmpeg-merge.service.js";
import { isPlaceholderClip } from "../videos/placeholder-clip.js";
import { longEpisodeFfmpegUnavailable, longEpisodeMergeClipsInvalid, longEpisodeMergeFailed, longEpisodeMergeNotAllowed, longEpisodeNotFound, longInvalidData, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { toEpisodeDetail } from "./episode-detail.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { PLACEHOLDER_ADAPTER } from "../narration/local-narration-generation.service.js";

const FINAL_PATH = "videos/final/instagram_reel.mp4" as const;
const statuses: readonly LongEpisodeStatus[] = LONG_EPISODE_STATUSES;
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

  private detail(episode: Episode): LongEpisodeDetail { return toEpisodeDetail(episode); }

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
    // "Larger than zero" is the right test for the local fake path, whose clips *are* placeholders by design.
    // It is the wrong test for a run that went to Runway: there a placeholder means the download was thrown
    // away, which is what six paid scenes looked like on disk while every earlier check read green — and
    // concatenating those produces a file that reaches the library calling itself the final video.
    const paid = rawRecords.some((item) => (item as VideoRecord).execution_mode === "runway");
    try { await Promise.all(clips.map(async (file) => { const { size } = await fs.stat(file); if (size <= 0 || (paid && isPlaceholderClip(size))) throw new Error("clip"); })); }
    catch { throw longEpisodeMergeClipsInvalid(); }
    return clips;
  }

  /**
   * Exactly the same gating as video-merge.service.ts's identical mergeScenes() (see that doc comment for the
   * full reasoning) — narrationAudioPath is gated on narrationEnabled AND file existence/validity (a stale or
   * toggled-off file must never fail the merge, it just falls back to silence for that scene); subtitleText is
   * independent, gated on subtitlesEnabled AND that scene having narration text, regardless of audio existence.
   */
  /**
   * Scenes whose narration audio was written without a TTS credential.
   *
   * A placeholder is silent, so leaving it out changes nothing anyone can hear — what changes is that the app
   * stops presenting it as narration it produced. Reading the record is the only way to tell: the file itself
   * is a well-formed MP3 header and passes every check that asks whether audio exists.
   *
   * Unreadable or missing records mean no scene is treated as a placeholder. Erring that way keeps a merge
   * working when this file is absent, and the worst case is the behaviour that existed before this method.
   */
  private async placeholderNarrationScenes(id: string, number: number): Promise<ReadonlySet<SceneNumber>> {
    const placeholders = new Set<SceneNumber>();
    let raw: unknown;
    try { raw = JSON.parse(await fs.readFile(path.join(this.files(id, number).episode, "narration_generation_records.json"), "utf8")); } catch { return placeholders; }
    if (!Array.isArray(raw)) return placeholders;
    for (const item of raw) {
      if (!object(item) || item.adapter !== PLACEHOLDER_ADAPTER) continue;
      const sceneNumber = item.scene_number;
      if (typeof sceneNumber === "number") placeholders.add(sceneNumber as SceneNumber);
    }
    return placeholders;
  }

  private async mergeScenes(id: string, number: number, episode: Episode, clips: readonly string[], sceneNumbers: readonly SceneNumber[]): Promise<MergeSceneInput[]> {
    const projectSettings = (await this.projects.get(id)).project.settings;
    const scenes = episode.script.scenes;
    const scriptScenes = Array.isArray(scenes) ? scenes : [];
    // Which scenes have narration that is only a placeholder. Read once here rather than re-derived from the
    // file, because the file cannot tell you: four bytes of MP3 header is a valid file of non-zero size, and
    // asking `size > 0` put it into finished videos as though it were a voice. The record is what knows.
    const placeholderScenes = await this.placeholderNarrationScenes(id, number);
    return Promise.all(sceneNumbers.map(async (sceneNumber, index) => {
      const scene = scriptScenes[index];
      const narrationText = object(scene) && typeof scene.narration === "string" ? scene.narration.trim() : "";
      const file = this.narrationAudio(id, number, sceneNumber);
      const hasRealAudio = !placeholderScenes.has(sceneNumber)
        && (await fs.stat(file).then((stat) => stat.size > 0).catch(() => false));
      const narrationAudioPath = projectSettings.narrationEnabled && hasRealAudio ? file : null;
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

  /**
   * The path to this Episode's merged final video, once there is one worth serving.
   *
   * Refuses a file that is only as long as the placeholder clip, the same test the merge itself applies to its
   * inputs. A merged file cannot be smaller than the clips that went into it, so a file this size means the
   * merge concatenated stubs — and a player pointed at that draws a black box while calling itself the final
   * video, which is the exact claim the 32-byte scene files were making on disk.
   */
  async content(projectId: string, number: number): Promise<{ path: string }> {
    const id = projectId.trim();
    await this.loadEpisode(id, number);
    const file = this.final(id, number);
    let size: number;
    try { const stat = await fs.stat(file); if (!stat.isFile()) throw longEpisodeMergeClipsInvalid(); size = stat.size; }
    catch { throw longEpisodeMergeClipsInvalid(); }
    if (size <= 0 || isPlaceholderClip(size)) throw longEpisodeMergeClipsInvalid();
    return { path: file };
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
