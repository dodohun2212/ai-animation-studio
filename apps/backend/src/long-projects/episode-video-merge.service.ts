import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { LONG_EPISODE_STATUSES, isSceneNumber, sceneNumbersFor, type LongEpisodeDetail, type LongEpisodeStatus, type MergeLongEpisodeVideosResponse, type SceneNumber } from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { FfmpegMergeEngine, MediaToolError, type MediaCommandRunner, type MergeSceneInput } from "../videos/ffmpeg-merge.service.js";
import { AudioLibraryService } from "../audio/audio-library.service.js";
import { isPlaceholderClip } from "../videos/placeholder-clip.js";
import { FINAL_VIDEO_LOCK_KEY, ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { longAudioStartOutOfRange, longEpisodeFfmpegUnavailable, longEpisodeMergeBusy, longEpisodeMergeClipsInvalid, longEpisodeMergeFailed, longEpisodeMergeAlreadyCompleted, longEpisodeMergeNotAllowed, longEpisodeNotFound, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, episodeProjectRelativePath, longStoryRoot } from "./long-project-paths.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { toEpisodeDetail } from "./episode-detail.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { PLACEHOLDER_ADAPTER } from "../narration/local-narration-generation.service.js";

const FINAL_PATH = "videos/final/instagram_reel.mp4" as const;
/** Same numbers the short project's merge uses — see MergeAudioSettings for why the bgm default splits by mode. */
const DEFAULT_BGM_VOLUME = 0.25;
const DEFAULT_BGM_FADE_SECONDS = 2;
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

  /**
   * `lockTimeoutMs`: same test seam as the short project's merge.
   *
   * `listDirectory` is a seam for one thing only — proving that a listing which fails for a reason other than
   * "not there" does not renumber the archive on top of a cut that already exists. That failure cannot be
   * staged with real files without also breaking the write that follows it, and then the test passes whichever
   * way the code behaves (measured: it did).
   */
  constructor(private readonly projectsRoot: string, runner?: MediaCommandRunner, private readonly audioLibrary?: AudioLibraryService, private readonly lockTimeoutMs?: number, private readonly listDirectory: (directory: string) => Promise<string[]> = (directory) => fs.readdir(directory)) { this.engine = new FfmpegMergeEngine(runner); this.projects = new LongProjectsService(projectsRoot); }

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
    // An Episode listed in the outline but never scripted has no directory yet, so this read is ENOENT — which
    // `json()` reports as `longNotFound()`, "Long project was not found". The project is right there; the person
    // was looking at it a moment ago. Measured over real data: Episode 2 of a real long project answered 200 for
    // its detail and 404 "Long project was not found" for its video work, in the same breath.
    //
    // The truthful answer is the one a scripted Episode in the wrong state already gets. episode-narration
    // does exactly this and says why: a per-episode project.json that is not there yet is "no script yet", not
    // a storage failure and not a missing project.
    let raw: unknown;
    try { raw = await this.json(f.project); }
    catch (error) { if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) throw longEpisodeMergeNotAllowed(); throw error; }
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
  /**
   * Copies the current final video into `videos/final/history/` before a new merge replaces it.
   *
   * `instagram_reel_v{NNN}.mp4` — the same name the short project's video library archives under, and the same
   * name this Episode's own version routes read back. A third naming scheme would put the copies somewhere
   * nothing can list, which is the state Episode scene clips were in until this week: preserved and unreachable,
   * which is only a quieter version of not preserved at all.
   *
   * Silent when there is nothing to keep — a first merge has no previous cut — and it never fails the merge:
   * losing the archive is bad, losing the merge someone is waiting on because the archive failed is worse.
   */
  private async archiveFinal(id: string, number: number): Promise<void> {
    const current = this.final(id, number);
    const bytes = await fs.readFile(current).catch(() => undefined);
    if (!bytes || bytes.length === 0) return;
    const directory = path.join(path.dirname(current), "history");
    await fs.mkdir(directory, { recursive: true }).catch(() => undefined);

    // "The directory is not there yet" is the first archive and reads as none. Every other failure throws, and
    // that difference is the whole point: this list decides the next version number, so a readdir that failed
    // for any other reason (a lock, a permission, an I/O error — none of them exotic on Windows) used to come
    // back empty, numbering restarted at v001, and the copy landed on top of a cut that was already there.
    // That cut was merged from paid Runway clips. The short project's own history listing was fixed for
    // exactly this (docs/06_DECISIONS.md D-036's third question); the Episode kept the permissive copy.
    let entries: string[];
    try { entries = await this.listDirectory(directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") entries = [];
      else throw longStorageError();
    }
    const versions = entries.map((name) => /^instagram_reel_v(\d{3})\.mp4$/.exec(name))
      .filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1]));
    const target = path.join(directory, `instagram_reel_v${String((versions.length ? Math.max(...versions) : 0) + 1).padStart(3, "0")}.mp4`);
    // Temp then rename, like every other media write in this app: a half-written archive is a file that looks
    // like a kept cut and is not one.
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    let renamed = false;
    try {
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, target);
      renamed = true;
    } catch { throw longStorageError(); }
    finally { if (!renamed) await fs.unlink(temporary).catch(() => undefined); }
  }

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
    if (episode.state === "completed") throw longEpisodeMergeAlreadyCompleted();
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

  /**
   * This merge's audio, in the short project's own vocabulary.
   *
   * Same rules, deliberately: `"narration"` and `"narration+bgm"` need narration audio to actually exist,
   * `"bgm"` does not and only needs a track, and an omitted request falls back to whatever the Episode's own
   * settings say. Two spellings of the same choice would be two places to get it wrong, and one of the ways to
   * get it wrong ships a video without the credit its licence requires.
   */
  private async resolveAudio(id: string, number: number, episode: Episode, request: unknown): Promise<{ mode: "narration" | "narration+bgm" | "bgm" | "silent"; trackId?: string; volume: number; fadeSeconds: number; startSeconds: number }> {
    const narrationAvailable = await this.narrationAvailable(id, number, episode);
    const fallbackMode = narrationAvailable && await this.narrationEnabled(id) ? "narration" as const : "silent" as const;
    const fallback = { mode: fallbackMode, volume: DEFAULT_BGM_VOLUME, fadeSeconds: DEFAULT_BGM_FADE_SECONDS, startSeconds: 0 };
    if (request === undefined) return fallback;
    if (!object(request) || Object.keys(request).some((key) => key !== "audio")) throw longInvalidRequest();
    if (request.audio === undefined) return fallback;
    const audio = request.audio;
    if (!object(audio) || Object.keys(audio).some((key) => !["mode", "trackId", "volume", "fadeSeconds", "startSeconds"].includes(key))) throw longInvalidRequest();
    const mode = audio.mode;
    if (mode !== "narration" && mode !== "narration+bgm" && mode !== "bgm" && mode !== "silent") throw longInvalidRequest("audio.mode must be narration, narration+bgm, bgm, or silent.");
    if ((mode === "narration" || mode === "narration+bgm") && !narrationAvailable) throw longInvalidRequest("This Episode has no narration audio to include.");
    const needsTrack = mode === "narration+bgm" || mode === "bgm";
    if (needsTrack && (typeof audio.trackId !== "string" || !audio.trackId.trim())) throw longInvalidRequest(`audio.trackId is required for ${mode}.`);
    if (audio.volume !== undefined && (typeof audio.volume !== "number" || !Number.isFinite(audio.volume) || audio.volume < 0 || audio.volume > 1)) throw longInvalidRequest("audio.volume must be between 0 and 1.");
    if (audio.fadeSeconds !== undefined && (typeof audio.fadeSeconds !== "number" || !Number.isFinite(audio.fadeSeconds) || audio.fadeSeconds < 0)) throw longInvalidRequest("audio.fadeSeconds must be a non-negative number.");
    // Shape only, same split as the short project: whether it is inside this track is asked where the length is known.
    if (audio.startSeconds !== undefined && (typeof audio.startSeconds !== "number" || !Number.isFinite(audio.startSeconds) || audio.startSeconds < 0)) throw longInvalidRequest("audio.startSeconds must be a non-negative number.");
    return {
      mode,
      ...(needsTrack ? { trackId: audio.trackId as string } : {}),
      // Same split the short merge makes: 0.25 keeps music under a voice, and with no voice that reason is gone.
      volume: typeof audio.volume === "number" ? audio.volume : (mode === "bgm" ? 1 : DEFAULT_BGM_VOLUME),
      fadeSeconds: typeof audio.fadeSeconds === "number" ? audio.fadeSeconds : DEFAULT_BGM_FADE_SECONDS,
      startSeconds: typeof audio.startSeconds === "number" ? audio.startSeconds : 0,
    };
  }

  /** Real files on disk, matching what the Episode's own GET reports to the screen. */
  private async narrationAvailable(id: string, number: number, _episode: Episode): Promise<boolean> {
    const directory = path.join(this.files(id, number).episode, "narration");
    try {
      const entries = await fs.readdir(directory);
      const sizes = await Promise.all(entries.filter((name) => name.endsWith(".mp3")).map(async (name) => {
        try { return (await fs.stat(path.join(directory, name))).size; } catch { return 0; }
      }));
      return sizes.some((size) => size > 0);
    } catch { return false; }
  }

  private async narrationEnabled(id: string): Promise<boolean> {
    try { return (await this.projects.get(id)).project.settings.narrationEnabled; } catch { return false; }
  }

  async merge(projectId: string, number: number, request?: unknown): Promise<MergeLongEpisodeVideosResponse> {
    const id = projectId.trim(); const episode = await this.loadEpisode(id, number); const clips = await this.approvedClips(id, number, episode);
    const audio = await this.resolveAudio(id, number, episode, request);
    // Resolved before any rendering starts, like the short project's merge: an unknown track should fail here
    // rather than after a render nobody can undo.
    let bgmPath: string | undefined;
    let bgmTrack: { attributionRequired: boolean; attributionText?: string } | undefined;
    if (audio.mode === "narration+bgm" || audio.mode === "bgm") {
      if (!this.audioLibrary) throw longInvalidRequest("BGM is not available in this configuration.");
      bgmPath = (await this.audioLibrary.content(audio.trackId!)).path;
      const track = await this.audioLibrary.get(audio.trackId!);
      // Same refusal as the short project's, with the same code and the track's length attached — 캡틴D puts
      // music on Episodes, so a control that only worked on short projects would not work where it is used.
      if (audio.startSeconds >= track.durationSeconds) throw longAudioStartOutOfRange(track.durationSeconds);
      bgmTrack = { attributionRequired: track.attributionRequired, ...(track.attributionText ? { attributionText: track.attributionText } : {}) };
    }
    try { for (const clip of clips) await this.engine.probe(clip); }
    catch (error) { if (error instanceof MediaToolError && error.kind === "unavailable") throw longEpisodeFfmpegUnavailable(); throw longEpisodeMergeClipsInvalid(); }
    const rendering = { ...episode, state: "rendering" as const, updated_at: new Date().toISOString() };
    await this.saveEpisode(id, number, rendering);
    // Same key the Episode's Instagram publish takes while it reads the file: the post must never be built
    // from a cut this render is replacing. Refused rather than queued if something else holds it — nothing has
    // been rendered at that point, and a button that waits behind a minutes-long upload reads as a hang.
    return withProjectLock(path.join(longStoryRoot(this.projectsRoot, id), episodeDirectoryName(number)), FINAL_VIDEO_LOCK_KEY,
      () => this.render(id, number, episode, rendering, clips, audio, bgmPath, bgmTrack), this.lockTimeoutMs === undefined ? undefined : { timeoutMs: this.lockTimeoutMs })
      .catch(async (error: unknown) => {
        if (!(error instanceof ProjectLockTimeoutError)) throw error;
        await this.saveEpisode(id, number, episode).catch(() => undefined);
        throw longEpisodeMergeBusy();
      });
  }

  /** The render itself, under {@link FINAL_VIDEO_LOCK_KEY}. */
  private async render(
    id: string, number: number,
    episode: Episode,
    rendering: Episode,
    clips: readonly string[],
    audio: { mode: string; trackId?: string; volume: number; fadeSeconds: number; startSeconds: number },
    bgmPath: string | undefined,
    bgmTrack: { attributionRequired: boolean; attributionText?: string } | undefined,
  ): Promise<MergeLongEpisodeVideosResponse> {
    try {
      const output = this.final(id, number); await fs.mkdir(path.dirname(output), { recursive: true });
      // The cut this merge is about to replace, kept. Re-merging with different audio or after restoring a
      // clip used to overwrite the finished video in place, and the previous cut — which someone may already
      // have watched, approved, or been about to publish — was simply gone. Archiving costs a local file copy.
      await this.archiveFinal(id, number);

      const mergeScenes = await this.mergeScenes(id, number, episode, clips, sceneNumbersFor(this.sceneCount(episode)));
      await this.engine.merge(mergeScenes, this.clipDurationSeconds(episode), output, await this.ratio(id, number));
      if (bgmPath) await this.engine.mixBackgroundMusic(output, bgmPath, audio.volume, audio.fadeSeconds, output, audio.startSeconds);
      // Copied as a value at merge time, never looked up later: the credit line has to survive the track being
      // edited or deleted, because what was published cannot be unpublished (D-003).
      const usedAudio = {
        mode: audio.mode,
        ...(audio.trackId ? { track_id: audio.trackId } : {}),
        ...(bgmTrack?.attributionRequired !== undefined ? { attribution_required: bgmTrack.attributionRequired } : {}),
        ...(bgmTrack?.attributionText !== undefined ? { attribution_text: bgmTrack.attributionText } : {}),
      };
      const completed = { ...rendering, state: "completed" as const, updated_at: new Date().toISOString(), final_video_path: FINAL_PATH, used_audio: usedAudio };
      await this.saveEpisode(id, number, completed);
      return { episode: this.detail(completed), finalVideoPath: FINAL_PATH, openablePath: episodeProjectRelativePath(number, FINAL_PATH) };
    } catch (error) {
      await this.fail(id, number, rendering);
      if (error instanceof MediaToolError && error.kind === "unavailable") throw longEpisodeFfmpegUnavailable();
      throw longEpisodeMergeFailed();
    }
  }
}
