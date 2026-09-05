import * as fs from "node:fs/promises";
import { isPlaceholderClip } from "./placeholder-clip.js";
import { PLACEHOLDER_ADAPTER } from "../narration/local-narration-generation.service.js";
import { FINAL_VIDEO_LOCK_KEY, ProjectLockTimeoutError, withProjectLock } from "./project-lock.js";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { AUDIO_MODES, FINAL_VIDEO_RELATIVE_PATH, isAudioMode, type AudioMode, isPhotoCardSubtitleLayout, PHOTO_CARD_SUBTITLE_CENTER, PHOTO_CARD_SUBTITLE_SCALE, sceneNumbersFor, WorkflowState, type MergeVideosResponse, type PhotoCardSubtitleLayout, type SceneNumber } from "@ai-animation-studio/shared";

import { photoCardFor, storedSubtitleLayout, toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject, StoredUsedAudio } from "../projects/project-storage.schema.js";
import { sceneValue } from "../images/image-prompt.js";
import { AudioLibraryService } from "../audio/audio-library.service.js";
import { FfmpegMergeEngine, MediaToolError, type MediaCommandRunner, type MergeSceneInput } from "./ffmpeg-merge.service.js";
import { audioStartOutOfRange, ffmpegUnavailable, videoMergeAlreadyPublished, videoMergeBusy, videoMergeClipsInvalid, videoMergeContentUnavailable, videoMergeFailed, videoMergeAlreadyCompleted, videoMergeInvalidRequest, videoMergeNotAllowed, videoMergeStorageError } from "./video-merge-api.error.js";
import { shortProjectAspectRatio } from "../projects/project-aspect.js";

const DEFAULT_BGM_VOLUME = 0.25;
const DEFAULT_BGM_FADE_SECONDS = 2;
type StoredReview = { scene_number: SceneNumber; status: "pending" | "approved" };
/** Mirrors MergeAudioSettings["mode"] — the stored record and the request speak the same vocabulary. */

interface ResolvedAudioSettings { mode: AudioMode; trackId?: string; volume: number; fadeSeconds: number; startSeconds: number }

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
  return project.generated_narrations.some((file, index) => typeof file === "string" && file.length > 0 && !isPlaceholderNarration(project, index + 1));
}

/**
 * Whether one scene's narration is the silent stub the keyless path writes.
 *
 * `generated_narrations` records a path, and the keyless run fills every one of them with a four-byte silent
 * mp3 — so "a path is recorded" said a project had a voice when it had never bought one. The mode was accepted,
 * the merge burned the stub in, and the finished video was silent where the narration should be, with nothing
 * anywhere saying so.
 *
 * Only a record that names the placeholder adapter disqualifies a scene. A scene with no record still counts:
 * narration made before that field existed is real, and taking it away would be the same mistake pointing the
 * other way. `local-narration-generation.service.ts` reads the same field for the same reason when it decides
 * whether audio is still good.
 */
function isPlaceholderNarration(project: StoredProject, scene: number): boolean {
  const record: unknown = project.narration_generation_records?.[scene - 1];
  if (typeof record !== "object" || record === null) return false;
  return (record as { adapter?: unknown }).adapter === PLACEHOLDER_ADAPTER;
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
/** Both modes that carry a track. Named once so a third caller cannot forget the newer of the two. */
const usesBgm = (mode: string): boolean => mode === "narration+bgm" || mode === "bgm";

/**
 * The bgm level to use when the request does not say.
 *
 * 0.25 exists to keep music under a voice. With no voice, that reason is gone, and applying it anyway would
 * make someone's own upload quiet for a cause the screen never mentions.
 */
const defaultBgmVolume = (mode: string): number => (mode === "bgm" ? 1 : DEFAULT_BGM_VOLUME);

/**
 * This merge's subtitle layout for a photo card: what was asked for, on top of what the card already uses.
 *
 * Merged with the stored values rather than with the defaults, so sending only one number moves only that one
 * and leaves the other where the person put it last time.
 *
 * Out of range is refused. Clamping was the alternative and it is the same shape of defect as the storage
 * schema that accepted a mode it could not read back: the screen would send one number, the video would be made
 * from another, and nothing anywhere would say so. A card is also the only project this means anything for —
 * sending it for an ordinary project is refused rather than ignored, because ignoring it would let a screen
 * believe it had a control it does not have.
 */
function resolveSubtitleLayout(project: StoredProject, request: unknown): PhotoCardSubtitleLayout {
  const stored = storedSubtitleLayout(project);
  if (!isObject(request) || request.subtitleLayout === undefined) return stored;
  if (!photoCardFor(project)) throw videoMergeInvalidRequest("subtitleLayout applies to photo cards only.");
  const asked = request.subtitleLayout;
  if (!isObject(asked) || Object.keys(asked).some((key) => !["scale", "center"].includes(key))) throw videoMergeInvalidRequest();
  const merged = {
    scale: asked.scale === undefined ? stored.scale : asked.scale,
    center: asked.center === undefined ? stored.center : asked.center,
  };
  if (!isPhotoCardSubtitleLayout(merged)) {
    throw videoMergeInvalidRequest(`subtitleLayout.scale must be ${PHOTO_CARD_SUBTITLE_SCALE.min}-${PHOTO_CARD_SUBTITLE_SCALE.max} and subtitleLayout.center ${PHOTO_CARD_SUBTITLE_CENTER.min}-${PHOTO_CARD_SUBTITLE_CENTER.max}.`);
  }
  return merged;
}

function resolveAudioSettings(project: StoredProject, request: unknown): ResolvedAudioSettings {
  const narrationAvailable = narrationAvailableFor(project);
  const defaultMode: AudioMode = narrationAvailable && toShortProjectSettings(project).narrationEnabled ? "narration" : "silent";
  const fallback: ResolvedAudioSettings = { mode: defaultMode, volume: DEFAULT_BGM_VOLUME, fadeSeconds: DEFAULT_BGM_FADE_SECONDS, startSeconds: 0 };
  if (request === undefined) return fallback;
  if (!isObject(request) || Object.keys(request).some((key) => key !== "audio" && key !== "subtitleLayout")) throw videoMergeInvalidRequest();
  if (request.audio === undefined) return fallback;
  const audio = request.audio;
  if (!isObject(audio) || Object.keys(audio).some((key) => !["mode", "trackId", "volume", "fadeSeconds", "startSeconds"].includes(key))) throw videoMergeInvalidRequest();
  if (!isAudioMode(audio.mode)) throw videoMergeInvalidRequest(`audio.mode must be ${AUDIO_MODES.join(", ")}.`);
  // Deliberately not "bgm": music alone has nothing to mix a voice into, so a project without narration can
  // ask for it. That was the one thing the old vocabulary could not express.
  if ((audio.mode === "narration" || audio.mode === "narration+bgm") && !narrationAvailable) throw videoMergeInvalidRequest("This project has no narration audio to include.");
  if (usesBgm(audio.mode) && (typeof audio.trackId !== "string" || !audio.trackId.trim())) throw videoMergeInvalidRequest(`audio.trackId is required for ${audio.mode}.`);
  if (audio.trackId !== undefined && typeof audio.trackId !== "string") throw videoMergeInvalidRequest();
  if (audio.volume !== undefined && (typeof audio.volume !== "number" || !Number.isFinite(audio.volume) || audio.volume < 0 || audio.volume > 1)) throw videoMergeInvalidRequest("audio.volume must be between 0 and 1.");
  if (audio.fadeSeconds !== undefined && (typeof audio.fadeSeconds !== "number" || !Number.isFinite(audio.fadeSeconds) || audio.fadeSeconds < 0)) throw videoMergeInvalidRequest("audio.fadeSeconds must be a non-negative number.");
  // Shape only. Whether the number is inside *this* track is asked later, where the track's real length is
  // known — and that refusal carries the length, which is the part a person can act on.
  if (audio.startSeconds !== undefined && (typeof audio.startSeconds !== "number" || !Number.isFinite(audio.startSeconds) || audio.startSeconds < 0)) throw videoMergeInvalidRequest("audio.startSeconds must be a non-negative number.");
  return {
    mode: audio.mode,
    ...(usesBgm(audio.mode) ? { trackId: audio.trackId as string } : {}),
    volume: typeof audio.volume === "number" ? audio.volume : defaultBgmVolume(audio.mode),
    fadeSeconds: typeof audio.fadeSeconds === "number" ? audio.fadeSeconds : DEFAULT_BGM_FADE_SECONDS,
    startSeconds: typeof audio.startSeconds === "number" ? audio.startSeconds : 0,
  };
}

@Injectable()
export class LocalVideoMergeService {
  private readonly engine: FfmpegMergeEngine;

  /** `lockTimeoutMs` exists for the same reason withProjectLock takes one: a test can exercise the refusal in milliseconds instead of really waiting out the default. */
  constructor(private readonly projects: LocalProjectRepository, private readonly projectsRoot: string, runner?: MediaCommandRunner, private readonly audioLibrary?: AudioLibraryService, private readonly lockTimeoutMs?: number) {
    this.engine = new FfmpegMergeEngine(runner);
  }

  private projectDirectory(projectId: string): string { return path.join(this.projectsRoot, projectId); }
  private clip(projectId: string, scene: SceneNumber): string { return path.join(this.projectDirectory(projectId), "videos", "runway", `scene${scene}.mp4`); }
  /** A photo card's single picture, kept where every project's scene images live so nothing needs a second convention. */
  private cardImage(projectId: string): string { return path.join(this.projectDirectory(projectId), "images", "scene1.png"); }
  private final(projectId: string): string { return path.join(this.projectDirectory(projectId), FINAL_VIDEO_RELATIVE_PATH); }

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
  private async mergeScenes(project: StoredProject, clips: readonly string[], scenes: readonly SceneNumber[], includeNarration: boolean, stillDurationSeconds?: number, subtitleLayout?: PhotoCardSubtitleLayout): Promise<MergeSceneInput[]> {
    const settings = toShortProjectSettings(project);
    return Promise.all(scenes.map(async (scene, index) => {
      const file = project.generated_narrations[scene - 1];
      // The same question narrationAvailableFor asks, so the mode a person was allowed to pick is the mode
      // they actually get. Asking a narrower one here is what let "나레이션" produce a silent video.
      const narrationAudioPath = includeNarration && typeof file === "string" && !isPlaceholderNarration(project, index + 1)
        && (await fs.stat(file).then((stat) => stat.size > 0).catch(() => false)) ? file : null;
      const subtitleText = settings.subtitlesEnabled ? sceneValue(project.scenes[scene - 1], "narration") || null : null;
      return { clip: clips[index]!, narrationAudioPath, subtitleText, ...(stillDurationSeconds !== undefined ? { stillDurationSeconds, ...(subtitleLayout ? { subtitleLayout } : {}) } : {}) };
    }));
  }

  async content(projectId: string): Promise<{ path: string }> {
    const project = await this.projects.findById(projectId.trim());
    const file = this.final(project.project_id);
    // Same rule the merge itself applies to its inputs, now on the way back out. A merged file cannot be
    // smaller than the clips that went into it, so this size means placeholders were concatenated.
    const paid = project.video_generation_records.some((item) => typeof item === "object" && item !== null && (item as { execution_mode?: unknown }).execution_mode === "runway");
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size <= 0 || (paid && isPlaceholderClip(stat.size))) throw new Error("invalid");
    } catch {
      throw videoMergeContentUnavailable();
    }
    return { path: file };
  }

  /**
   * The material this project's final cut is made of, and whether it is held rather than played.
   *
   * The state gate is the same for both kinds and means the same thing — the material is settled, or a previous
   * merge failed and retrying is all that is left. What differs is *what is checked*, and that is the whole
   * reason this branches instead of a photo card being dressed up as an approved video run: a card has no
   * clips and no scene reviews, so demanding an approved reviews file would mean writing one that says six
   * scenes were reviewed when none were. A gate that has to be lied to is not a gate.
   */
  private async mergeMaterial(project: StoredProject): Promise<{ paths: string[]; stillDurationSeconds?: number }> {
    // A finished photo card may be made again, and an ordinary project may not. The gate exists to stop a
    // completed run being overwritten, and for a card there is nothing of that kind to overwrite: no paid
    // clips, no approvals, one picture and one line of text, and the previous final video is archived before
    // the new one is written. What it was actually stopping was a person changing their own subtitle — the
    // card would have had to be created again, under a new name, to move one number (Cowork Round 440).
    //
    // Published is the one exception, and it is its own refusal: see videoMergeAlreadyPublished.
    const remakeableCard = project.workflow_state === WorkflowState.Completed && photoCardFor(project);
    if (remakeableCard && project.instagram_post) throw videoMergeAlreadyPublished();
    if (project.workflow_state === WorkflowState.Completed && !remakeableCard) throw videoMergeAlreadyCompleted();
    if (!remakeableCard && project.workflow_state !== WorkflowState.VideosApproved && project.workflow_state !== WorkflowState.Failed) throw videoMergeNotAllowed();
    if (photoCardFor(project)) {
      const picture = this.cardImage(project.project_id);
      // The picture is the whole material. Checked for real bytes the same way a clip is, and never probed —
      // a still has no duration of its own, which is exactly what ffprobe refuses it for.
      const { size } = await fs.stat(picture).catch(() => ({ size: 0 }));
      if (size <= 0) throw videoMergeClipsInvalid();
      return { paths: [picture], stillDurationSeconds: toShortProjectSettings(project).clipDurationSeconds };
    }
    return { paths: await this.approvedClips(project) };
  }

  private async approvedClips(project: StoredProject): Promise<string[]> {
    // Same as the Episode side: Failed is written in one place, by a merge that did not finish, and nothing
    // was published when it did not. Retrying is the only sensible thing left, and it was refused.
    if (project.workflow_state === WorkflowState.Completed) throw videoMergeAlreadyCompleted();
    if (project.workflow_state !== WorkflowState.VideosApproved && project.workflow_state !== WorkflowState.Failed) throw videoMergeNotAllowed();
    let reviews: unknown;
    try { reviews = JSON.parse(await fs.readFile(path.join(this.projectDirectory(project.project_id), "generated_video_reviews.json"), "utf8")); }
    catch { throw videoMergeClipsInvalid(); }
    const scenes = scenesFor(project);
    if (!isApprovedReviews(reviews, scenes)) throw videoMergeClipsInvalid();
    const clips = scenes.map((scene) => this.clip(project.project_id, scene));
    // The Episode side had the same hole and the same reason for the same shape: "larger than zero" is right
    // for the local fake path, whose clips are placeholders by design, and wrong for a run that went to Runway,
    // where a placeholder means the download was lost. Only the paid case demands a real clip, so the
    // no-provider flow keeps working exactly as before.
    const paid = project.video_generation_records.some((item) => typeof item === "object" && item !== null && (item as { execution_mode?: unknown }).execution_mode === "runway");
    try { await Promise.all(clips.map(async (clip) => { const { size } = await fs.stat(clip); if (size <= 0 || (paid && isPlaceholderClip(size))) throw new Error("clip"); })); }
    catch { throw videoMergeClipsInvalid(); }
    return clips;
  }

  /**
   * Preserves whatever final video already exists before this merge overwrites it — a project only reaches
   * merge() again after a scene-video restore reopens VideosApproved (see video-library.service.ts's restore()),
   * so without this, a user who restores an old scene and re-merges would silently lose the previous final cut
   * Mirrors local-video-workflow.service.ts's private archive(), generalized to the
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
    const subtitleLayout = resolveSubtitleLayout(project, request);
    // Resolved before any state changes or rendering work starts — an unknown/unavailable track should fail
    // fast, the same as approvedClips() failing fast on invalid clips below, not mid-render.
    let bgmPath: string | undefined;
    let bgmAttribution: { attributionRequired: boolean; attributionText?: string } | undefined;
    if (usesBgm(audio.mode)) {
      if (!this.audioLibrary) throw videoMergeInvalidRequest("BGM is not available in this configuration.");
      bgmPath = (await this.audioLibrary.content(audio.trackId!)).path;
      const track = await this.audioLibrary.get(audio.trackId!);
      // Asked here because this is where the track's length is known. Refused rather than clamped: a start the
      // person did not choose sounds like the feature ignoring them, and the sentence they need is how long
      // the song is.
      if (audio.startSeconds >= track.durationSeconds) throw audioStartOutOfRange(track.durationSeconds);
      bgmAttribution = { attributionRequired: track.attributionRequired, ...(track.attributionText ? { attributionText: track.attributionText } : {}) };
    }
    const material = await this.mergeMaterial(project);
    // Probing asks "is this a real video", which a still is not and never claims to be. Skipped for a card
    // rather than the probe being loosened for every clip in the app.
    if (material.stillDurationSeconds === undefined) {
      try { for (const clip of material.paths) await this.engine.probe(clip); }
      catch (error) {
        if (error instanceof MediaToolError && error.kind === "unavailable") throw ffmpegUnavailable();
        throw videoMergeClipsInvalid();
      }
    }
    const cardScenes: SceneNumber[] = [1 as SceneNumber];
    const mergeScenes = await this.mergeScenes(project, material.paths, material.stillDurationSeconds === undefined ? scenesFor(project) : cardScenes, audio.mode !== "silent", material.stillDurationSeconds, subtitleLayout);
    const clipDurationSeconds = toShortProjectSettings(project).clipDurationSeconds;
    const rendering = { ...project, workflow_state: WorkflowState.Rendering, updated_at: new Date().toISOString() };
    try { await this.projects.save(rendering); } catch { throw videoMergeStorageError(); }
    // Held across the render and the save that follows it. The Instagram publish takes this same key while it
    // reads the file, so a post can never be built from a cut this merge is in the middle of replacing — the
    // one action in this app that cannot be undone must not race the one that rewrites what it sends.
    return withProjectLock(this.projectDirectory(project.project_id), FINAL_VIDEO_LOCK_KEY, () => this.render(rendering, audio, subtitleLayout, bgmPath, bgmAttribution, mergeScenes, clipDurationSeconds), this.lockTimeoutMs === undefined ? undefined : { timeoutMs: this.lockTimeoutMs })
      .catch(async (error: unknown) => {
        if (!(error instanceof ProjectLockTimeoutError)) throw error;
        // Nothing was rendered, so the project must not be left saying it is rendering.
        await this.projects.save({ ...project, updated_at: new Date().toISOString() }).catch(() => undefined);
        throw videoMergeBusy();
      });
  }

  /** The render itself, under {@link FINAL_VIDEO_LOCK_KEY}. Split out so the lock wraps exactly the work that writes the final video. */
  private async render(
    rendering: StoredProject,
    audio: ResolvedAudioSettings,
    subtitleLayout: PhotoCardSubtitleLayout,
    bgmPath: string | undefined,
    bgmAttribution: { attributionRequired: boolean; attributionText?: string } | undefined,
    mergeScenes: MergeSceneInput[],
    clipDurationSeconds: number,
  ): Promise<MergeVideosResponse> {
    const project = rendering;
    try {
      await this.archiveExistingFinal(project.project_id);
      const finalPath = this.final(project.project_id);
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      // The project's own setting, read from where it is actually stored (project-aspect.ts). This passed
      // `style_profile.aspect` until that field turned out to be written by nothing, so every merge padded to a
      // portrait canvas — including landscape footage, which came out pillarboxed.
      await this.engine.merge(mergeScenes, clipDurationSeconds, finalPath, shortProjectAspectRatio(rendering));
      if (usesBgm(audio.mode) && bgmPath) {
        await this.engine.mixBackgroundMusic(finalPath, bgmPath, audio.volume, audio.fadeSeconds, finalPath, audio.startSeconds);
      }
      const usedAudio: StoredUsedAudio = {
        mode: audio.mode,
        ...(usesBgm(audio.mode) ? { track_id: audio.trackId! } : {}),
        ...(bgmAttribution?.attributionRequired !== undefined ? { attribution_required: bgmAttribution.attributionRequired } : {}),
        ...(bgmAttribution?.attributionText !== undefined ? { attribution_text: bgmAttribution.attributionText } : {}),
      };
      // Written only here, after the render that used it: a layout the person tried and abandoned never comes
      // back to change a later video, and a card merged again starts from what it actually looks like.
      const loreContext = photoCardFor(rendering)
        ? { ...rendering.lore_context, subtitle_scale: subtitleLayout.scale, subtitle_center: subtitleLayout.center }
        : rendering.lore_context;
      const completed = { ...rendering, lore_context: loreContext, workflow_state: WorkflowState.Completed, updated_at: new Date().toISOString(), final_video_path: FINAL_VIDEO_RELATIVE_PATH, used_audio: usedAudio };
      await this.projects.save(completed);
      return { project: toApiProject(completed), finalVideoPath: FINAL_VIDEO_RELATIVE_PATH };
    } catch (error) {
      await this.saveFailure(rendering);
      if (error instanceof MediaToolError && error.kind === "unavailable") throw ffmpegUnavailable();
      throw videoMergeFailed();
    }
  }
}
