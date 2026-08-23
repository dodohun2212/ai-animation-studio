import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import type { LongEpisodeDetail, LongEpisodeStatus, MergeLongEpisodeVideosResponse, SceneNumber } from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { FfmpegMergeEngine, MediaToolError, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";
import { longEpisodeFfmpegUnavailable, longEpisodeMergeClipsInvalid, longEpisodeMergeFailed, longEpisodeMergeNotAllowed, longEpisodeNotFound, longInvalidData, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const satisfies readonly SceneNumber[];
const FINAL_PATH = "videos/final/instagram_reel.mp4" as const;
const statuses: readonly LongEpisodeStatus[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed", "failed"];
type ObjectMap = Record<string, unknown>;
type Episode = ObjectMap & { number: number; state: LongEpisodeStatus; approved: boolean; script: ObjectMap; script_revision: number; updated_at: string };
type Review = { scene_number: SceneNumber; status: "pending" | "approved"; updated_at: string };
type VideoRecord = { scene_number: SceneNumber; job_id: string; status: "created" | "running" | "succeeded" | "interrupted"; execution_mode: "local_fake_no_provider" };

const object = (value: unknown): value is ObjectMap => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const scene = (value: unknown): value is SceneNumber => Number.isInteger(value) && SCENES.includes(value as SceneNumber);

/** Episode-scoped final rendering; its injectable runner keeps tests provider-free. */
@Injectable()
export class EpisodeVideoMergeService {
  private readonly engine: FfmpegMergeEngine;

  constructor(private readonly projectsRoot: string, runner?: MediaCommandRunner) { this.engine = new FfmpegMergeEngine(runner); }

  private files(id: string, number: number) {
    if (!isSafeProjectId(id)) throw longUnsafeId();
    const root = path.join(resolveSafeProjectDirectory(this.projectsRoot, id), "long_story");
    const episode = path.join(root, `Episode${String(number).padStart(2, "0")}`);
    const videos = path.join(episode, "videos");
    return { root, outlines: path.join(root, "episode_outlines.json"), longProject: path.join(root, "project.json"), project: path.join(episode, "project.json"), videos, records: path.join(episode, "video_generation_records.json"), reviews: path.join(episode, "generated_video_reviews.json") };
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
    return { episodeNumber: episode.number, title: String(episode.title), summary: String(episode.summary), mainEvent: String(episode.core_event), conflict: String(episode.conflict), cliffhanger: String(episode.cliffhanger), nextEpisodeHook: String(episode.next_connection), status: episode.state, approved: episode.approved, scriptRevision: episode.script_revision, script: episode.script as never, scriptHistoryCount: Array.isArray(episode.script_history) ? episode.script_history.length : 0 };
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

  private async approvedClips(id: string, number: number, episode: Episode): Promise<string[]> {
    if (episode.state !== "videos_approved") throw longEpisodeMergeNotAllowed();
    const [rawReviews, rawRecords] = await Promise.all([this.json(this.files(id, number).reviews).catch(() => { throw longEpisodeMergeClipsInvalid(); }), this.json(this.files(id, number).records).catch(() => { throw longEpisodeMergeClipsInvalid(); })]);
    if (!Array.isArray(rawReviews) || rawReviews.length !== 6 || !rawReviews.every((item) => object(item) && scene(item.scene_number) && item.status === "approved" && typeof item.updated_at === "string") || new Set(rawReviews.map((item) => (item as Review).scene_number)).size !== 6) throw longEpisodeMergeClipsInvalid();
    if (!Array.isArray(rawRecords) || rawRecords.length !== 6 || !rawRecords.every((item) => object(item) && scene(item.scene_number) && typeof item.job_id === "string" && item.job_id.length > 0 && item.status === "succeeded" && item.execution_mode === "local_fake_no_provider") || new Set(rawRecords.map((item) => (item as VideoRecord).scene_number)).size !== 6 || new Set(rawRecords.map((item) => (item as VideoRecord).job_id)).size !== 1) throw longEpisodeMergeClipsInvalid();
    const clips = SCENES.map((number_) => this.clip(id, number, number_));
    try { await Promise.all(clips.map(async (file) => { if ((await fs.stat(file)).size <= 0) throw new Error("empty"); })); }
    catch { throw longEpisodeMergeClipsInvalid(); }
    return clips;
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
      await this.engine.merge(clips, output, await this.ratio(id, number));
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
