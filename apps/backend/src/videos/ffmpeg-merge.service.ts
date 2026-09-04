import * as crypto from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { PhotoCardSubtitleLayout } from "@ai-animation-studio/shared";
import { escapeForFfmpegFilterPath, sceneSubtitleAss } from "./subtitle-file.js";

function currentModuleDirectory(): string {
  const cjsDirname: string | undefined = typeof __dirname === "string" ? __dirname : undefined;
  return cjsDirname ?? fileURLToPath(new URL(".", import.meta.url));
}

/**
 * Same repository-relative-asset reasoning as story-prompt.service.ts's promptsRoot() (see that function's doc
 * comment for the full explanation of why cwd can't be trusted and why each build output needs its own
 * candidate depth) — `fonts/` is this feature's equivalent static asset, needed by the `subtitles` burn-in
 * filter so Korean glyphs render the same regardless of what fonts happen to be installed on the machine
 * running FFmpeg. See apps/desktop/package.json's extraResources for the packaged copy step.
 */
function fontsRoot(): string {
  if (process.env.FONTS_ROOT) return process.env.FONTS_ROOT;
  const moduleDirectory = currentModuleDirectory();
  const candidates = [
    path.resolve(moduleDirectory, "../../../../fonts"),
    path.resolve(moduleDirectory, "../../../fonts"),
    path.resolve(moduleDirectory, "fonts"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export class MediaToolError extends Error {
  constructor(readonly kind: "unavailable" | "invalid" | "failed", message: string) { super(message); }
}

export interface MediaCommandResult { stdout: string; stderr: string; }
export type MediaCommandRunner = (arguments_: readonly string[]) => Promise<MediaCommandResult>;

/** Execute argument arrays only; no shell is used for FFmpeg or ffprobe. */
export const runMediaCommand: MediaCommandRunner = async (arguments_) => new Promise((resolve, reject) => {
  const [binary, ...args] = arguments_;
  if (!binary) { reject(new MediaToolError("unavailable", "Media tool is missing.")); return; }
  const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  child.on("error", (error: NodeJS.ErrnoException) => reject(new MediaToolError(error.code === "ENOENT" ? "unavailable" : "failed", "Media tool could not start.")));
  child.on("close", (code: number | null) => code === 0 ? resolve({ stdout, stderr }) : reject(new MediaToolError("failed", "Media command failed.")));
});

type ProbeData = { streams?: Array<{ codec_type?: unknown }>; format?: { duration?: unknown } };

function outputSize(ratio: unknown): [number, number] {
  return ratio === "16:9" || ratio === "1280:720" ? [1920, 1080] : [1080, 1920];
}

export interface MergeSceneInput {
  clip: string;
  /**
   * Seconds to hold `clip` for when it is a still image rather than a video.
   *
   * A photo card has one chosen picture and no footage, so there is nothing to play — the frame is held and
   * slowly zoomed instead (docs/06_DECISIONS.md: Captain D chose a Ken Burns move precisely because it costs no
   * provider call). Set only by that path; absent means `clip` is a real video and everything behaves as before.
   *
   * 🔴 A still must not be probed the way a clip is. Measured: `ffprobe` reports a PNG as `codec_type: "video"`,
   * so the stream check passes — and then `format.duration` is absent, so the duration check refuses it. The
   * probe is right to: a still has no duration of its own, which is why this field carries one. The caller
   * skips the probe for these scenes rather than the probe being loosened for everything.
   */
  stillDurationSeconds?: number;
  /** Photo cards only, alongside stillDurationSeconds: where this card's text goes. Absent means the defaults. */
  subtitleLayout?: PhotoCardSubtitleLayout;
  /** Path to that scene's narration audio, or null/undefined to fall back to silence. */
  narrationAudioPath?: string | null;
  /** That scene's narration text, or null/undefined to burn in no subtitle line. Independent of narrationAudioPath — video-merge.service.ts sets this based on ShortProjectSettings.subtitlesEnabled, which can be on with no narration audio at all (subtitles-only, no TTS spend, a real Shorts use case since many viewers watch muted). */
  subtitleText?: string | null;
}

/**
 * The slow push-in a held photo gets, at 30fps for `seconds`.
 *
 * Scaled up first so the zoom has real pixels to take rather than magnifying the output size, and centred so
 * the subject does not drift. The move is deliberately small — this is a caption card, and a picture that
 * lunges at the reader is harder to read, not livelier.
 */
/**
 * A slow push into a still, held for `seconds`.
 *
 * `d=1`, not `d=frames`. `zoompan`'s `d` is **output frames per input frame**, and the still arrives looped —
 * so `d=frames` multiplied instead of setting a length. Measured end to end on a real photo card: a five-second
 * card came out **625 seconds long and 79 MB**, and took nine and a half minutes to encode, because 125 looped
 * input frames each became 150 output ones. One frame in, one frame out, and the loop decides the duration.
 *
 * The zoom is a function of `on` (output frames so far) rather than `zoom+ε`, for the same reason: with one
 * output frame per input frame there is no previous frame inside the sequence to accumulate from. It also says
 * what it means — 1.15 by the end of the hold — instead of an epsilon whose total silently depends on the frame
 * count. The old expression added 0.0004 for 150 frames and so never passed 1.06; the cap it named was never
 * reached.
 *
 * 1.2× the output size, not 2×. The zoom only ever reaches 1.15, so 2× was four times the pixels for headroom
 * that cannot be used, and `zoompan` re-renders every output frame from that oversized input.
 */
/**
 * What the scene encoder is told, instead of leaving x264 on its defaults.
 *
 * It was left on them, and the defaults are CRF 23 / preset medium — a sensible choice for encoding a master,
 * and the wrong one for the only thing this function ever does: re-encode video a provider has already
 * compressed, after scaling it up. Cowork measured Episode 4 (Round 481): Runway's six clips arrive at 720x1280
 * carrying 0.126 bits per pixel, and the merged 1080x1920 file comes out at 0.055. The picture was stretched to
 * 2.25x the pixels and given *less* information to fill them with.
 *
 * CRF 18 is not "better than the source" — nothing here can be. It is close enough to transparent that the
 * second compression stops being the thing you see, which leaves Runway's own 720p as the ceiling, where it
 * belongs. `slow` buys a few percent of that quality for encode time nobody is watching; this runs once per
 * Episode, after minutes of paid generation.
 *
 * The cost is file size, measured on real files rather than guessed at: Episode 4 goes from 12.5MB to 24.4MB
 * and a 10-second photo card from 4.6MB to 10.1MB — about twice, both of them. A card is not the cheap case it
 * looks like: the slow zoom means every frame differs from the last, so it pays for motion like anything else.
 * Encode time roughly doubles too (4.9s to 8.3s for six scenes), once per Episode after minutes of paid
 * generation. Worth it: a person who paid for these clips should not have them thrown away by the last step.
 *
 * Named once because both branches below encode the same scenes with the same intent, and two copies of an
 * encoder setting is how one of them silently keeps the old default.
 */
const X264_QUALITY = ["-crf", "18", "-preset", "slow"] as const;

function kenBurns(width: number, height: number, seconds: number): string {
  const frames = Math.max(1, Math.round(seconds * 30));
  const scaled = (value: number) => Math.round(value * 1.2 / 2) * 2; // even dimensions: yuv420p needs them
  return `scale=${scaled(width)}:${scaled(height)}:force_original_aspect_ratio=increase,`
    + `zoompan=z='min(1+0.15*on/${frames},1.15)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`;
}

/** Small injectable engine mirroring Python FFmpegEngine's probe/normalize/concat sequence. */
export class FfmpegMergeEngine {
  constructor(private readonly runner: MediaCommandRunner = runMediaCommand, private readonly fontsDir: string = fontsRoot()) {}

  private async command(args: readonly string[]): Promise<MediaCommandResult> {
    try { return await this.runner(args); }
    catch (error) {
      if (error instanceof MediaToolError) throw error;
      throw new MediaToolError("failed", "Media command failed.");
    }
  }

  async probe(clip: string): Promise<void> {
    let result: MediaCommandResult;
    try { result = await this.command(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", clip]); }
    catch (error) { throw error instanceof MediaToolError && error.kind === "unavailable" ? error : new MediaToolError("invalid", "Scene video is invalid."); }
    try {
      const data = JSON.parse(result.stdout) as ProbeData;
      const hasVideo = Array.isArray(data.streams) && data.streams.some((stream) => stream.codec_type === "video");
      const duration = Number(data.format?.duration);
      if (!hasVideo || !Number.isFinite(duration) || duration <= 0) throw new Error("invalid");
    } catch { throw new MediaToolError("invalid", "Scene video is invalid."); }
  }

  /**
   * `scenes[index].narrationAudioPath` is that scene's narration audio file, or null/undefined to fall back to
   * silence (narration disabled, missing text, or generation never ran). The scene's video clip is always the
   * master duration — narration audio is never allowed to extend it. A real narration file is padded with
   * silence (`apad`) before `-shortest` so a narration shorter than the clip doesn't truncate the video the way
   * it would without padding; a narration longer than the clip is simply cut off at the clip's end by
   * `-shortest`, matching the agreed "warn before generating, don't reject after" overlong-narration handling
   * (see NarrationReviewScreen's length warning). `anullsrc` (used when there is no narration file) has no
   * natural duration of its own, so `-shortest` already caps it at the video's length without needing `apad`.
   *
   * `scenes[index].subtitleText`, when set, is burned into that same normalized clip via a single-cue ASS file
   * spanning the whole `clipDurationSeconds` (every project has one fixed clip length, so this is a project-wide
   * value, not per-scene) — see subtitle-file.ts. `fontsDir` (constructor option) is passed to the `subtitles`
   * filter's own `fontsdir` so Hangul renders identically regardless of what's installed system-wide; a missing
   * or empty fonts directory degrades to whatever libass's system font matching finds (readable, but not
   * guaranteed to match the intended look) rather than failing the merge.
   */
  async merge(scenes: readonly MergeSceneInput[], clipDurationSeconds: number, finalPath: string, ratio: unknown): Promise<void> {
    const [width, height] = outputSize(ratio);
    const directory = path.dirname(finalPath);
    const normalizedDirectory = path.join(directory, "normalized");
    await fs.mkdir(normalizedDirectory, { recursive: true });
    const normalized: string[] = [];
    const baseFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`;
    for (const [index, scene] of scenes.entries()) {
      const target = path.join(normalizedDirectory, `scene${index + 1}.mp4`);
      let filter = baseFilter;
      if (scene.subtitleText) {
        const assPath = path.join(normalizedDirectory, `scene${index + 1}.ass`);
        // A still is a photo card (see the input shape below), and a card's text is the whole point of the
        // frame rather than a caption under the action — it gets its own layout. Nothing new has to be threaded
        // through for that: the field that says "this is a still" is already here.
        const layout = scene.stillDurationSeconds === undefined ? "scene" : "photo-card";
        await fs.writeFile(assPath, sceneSubtitleAss(scene.subtitleText, clipDurationSeconds, width, height, layout, scene.subtitleLayout), "utf8");
        filter += `,subtitles='${escapeForFfmpegFilterPath(assPath)}':fontsdir='${escapeForFfmpegFilterPath(this.fontsDir)}'`;
      }
      // A still is looped for its own held duration and given the slow zoom before the shared filter runs; a
      // clip is opened as it always was. Everything after this — subtitles, audio mapping, encoder, concat — is
      // the same chain for both, which is the point of doing this as an input shape rather than a second merge.
      const stillSeconds = scene.stillDurationSeconds;
      // `-framerate 30` before the input, so the loop produces exactly the frames the output keeps. Without it the
      // image demuxer loops at its own 25, and every later step is counting in a rate nothing else uses.
      const input = stillSeconds === undefined ? ["-i", scene.clip] : ["-loop", "1", "-framerate", "30", "-t", String(stillSeconds), "-i", scene.clip];
      const sceneFilter = stillSeconds === undefined ? filter : `${kenBurns(width, height, stillSeconds)},${filter}`;
      if (scene.narrationAudioPath) {
        await this.command(["ffmpeg", "-y", ...input, "-i", scene.narrationAudioPath, "-filter_complex", "[1:a]apad[aout]", "-map", "0:v:0", "-map", "[aout]", "-vf", sceneFilter, "-c:v", "libx264", ...X264_QUALITY, "-c:a", "aac", "-shortest", target]);
      } else {
        await this.command(["ffmpeg", "-y", ...input, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v:0", "-map", "1:a:0", "-vf", sceneFilter, "-c:v", "libx264", ...X264_QUALITY, "-c:a", "aac", "-shortest", target]);
      }
      normalized.push(target);
    }
    const concatFile = path.join(normalizedDirectory, "concat.txt");
    await fs.writeFile(concatFile, normalized.map((item) => `file '${path.resolve(item).replaceAll("'", "''")}'`).join("\n"), "utf8");
    const temporaryFinal = path.join(directory, `.instagram_reel.${crypto.randomUUID()}.tmp.mp4`);
    try {
      await this.command(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", "-movflags", "+faststart", temporaryFinal]);
      const stat = await fs.stat(temporaryFinal);
      if (stat.size <= 0) throw new MediaToolError("failed", "Final output is empty.");
      await fs.rename(temporaryFinal, finalPath);
    } finally { await fs.unlink(temporaryFinal).catch(() => undefined); }
    // Only after the rename, and never on the way out of a failure.
    //
    // These are a cache, not an output: nothing reads them back, every merge rewrites them, and they cost a
    // second full-size copy of the finished video in the person's own data folder — 12-13MB per Episode, on a
    // machine that keeps every clip it has ever paid for. Deleting them once the final file exists loses
    // nothing anyone can miss.
    //
    // 🔴 Placed outside the try on purpose. A failed merge leaves them exactly where they are, because then
    // they stop being a cache and become the only record of what the run actually produced — the person is not
    // losing something rebuildable, they are losing the way to see why it broke (Cowork Round 384).
    await fs.rm(normalizedDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  /**
   * Mixes a background-music track under `inputPath`'s existing audio (narration, or silence — merge() above
   * always produces one audio stream either way) and writes the result to `outputPath`, leaving `inputPath`
   * itself untouched so the caller decides when/whether to replace it. `-stream_loop -1` on the bgm input loops
   * it indefinitely at the demuxer level (simpler than an `aloop` filter needing a sample-count) and `atrim` cuts
   * the loop down to `inputPath`'s own duration, so a bgm track shorter OR longer than the video both just work.
   * `amix`'s default loudness normalization is turned off (`normalize=0`) so narration keeps its own recorded
   * level — only `volume` (this call's own parameter) controls the bgm's level, not amix's input-count-based
   * guess.
   *
   * Deliberately constant attenuation, not sidechain-triggered ducking against narration: real ducking is
   * feasible here (inputPath's own audio track could drive a sidechaincompress key against the bgm) and is a
   * reasonable follow-up, but a fixed, conservative default volume is simpler to get right without a live
   * multi-track test rig, and still keeps narration intelligible (ducking or automatic volume adjustment were both
   * acceptable approaches).
   */
  /**
   * `startSeconds` seeks into the track before anything is read from it, so the music that lands on the video
   * is the part someone picked rather than whatever the song opens with. It sits before `-i` deliberately —
   * after it, FFmpeg decodes from the start and throws the beginning away, which is the same picture and a
   * much slower one — and before `-stream_loop`, so a track shorter than the video repeats from that point
   * instead of falling back to the opening bars halfway through.
   */
  async mixBackgroundMusic(inputPath: string, bgmPath: string, volume: number, fadeSeconds: number, outputPath: string, startSeconds = 0): Promise<void> {
    let duration: number;
    try {
      const result = await this.command(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", inputPath]);
      const data = JSON.parse(result.stdout) as { format?: { duration?: unknown } };
      duration = Number(data.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("invalid");
    } catch (error) {
      if (error instanceof MediaToolError && error.kind === "unavailable") throw error;
      throw new MediaToolError("invalid", "Merged video duration could not be determined.");
    }
    const fade = Math.max(0, Math.min(fadeSeconds, duration / 2));
    const fadeOutStart = Math.max(0, duration - fade);
    const filter = `[1:a]atrim=0:${duration.toFixed(3)},afade=t=in:st=0:d=${fade.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)},volume=${volume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;
    const temporary = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${crypto.randomUUID()}.tmp.mp4`);
    try {
      const music = startSeconds > 0 ? ["-ss", startSeconds.toFixed(3), "-stream_loop", "-1", "-i", bgmPath] : ["-stream_loop", "-1", "-i", bgmPath];
      await this.command(["ffmpeg", "-y", "-i", inputPath, ...music, "-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", temporary]);
      const stat = await fs.stat(temporary);
      if (stat.size <= 0) throw new MediaToolError("failed", "BGM mix output is empty.");
      await fs.rename(temporary, outputPath);
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
}
