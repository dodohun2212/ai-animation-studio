import * as crypto from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
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
  /** Path to that scene's narration audio, or null/undefined to fall back to silence. */
  narrationAudioPath?: string | null;
  /** That scene's narration text, or null/undefined to burn in no subtitle line. Independent of narrationAudioPath — video-merge.service.ts sets this based on ShortProjectSettings.subtitlesEnabled, which can be on with no narration audio at all (subtitles-only, no TTS spend, a real Shorts use case since many viewers watch muted). */
  subtitleText?: string | null;
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
    const baseFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`;
    for (const [index, scene] of scenes.entries()) {
      const target = path.join(normalizedDirectory, `scene${index + 1}.mp4`);
      let filter = baseFilter;
      if (scene.subtitleText) {
        const assPath = path.join(normalizedDirectory, `scene${index + 1}.ass`);
        await fs.writeFile(assPath, sceneSubtitleAss(scene.subtitleText, clipDurationSeconds, width, height), "utf8");
        filter += `,subtitles='${escapeForFfmpegFilterPath(assPath)}':fontsdir='${escapeForFfmpegFilterPath(this.fontsDir)}'`;
      }
      if (scene.narrationAudioPath) {
        await this.command(["ffmpeg", "-y", "-i", scene.clip, "-i", scene.narrationAudioPath, "-filter_complex", "[1:a]apad[aout]", "-map", "0:v:0", "-map", "[aout]", "-vf", filter, "-c:v", "libx264", "-c:a", "aac", "-shortest", target]);
      } else {
        await this.command(["ffmpeg", "-y", "-i", scene.clip, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v:0", "-map", "1:a:0", "-vf", filter, "-c:v", "libx264", "-c:a", "aac", "-shortest", target]);
      }
      normalized.push(target);
    }
    const concatFile = path.join(normalizedDirectory, "concat.txt");
    await fs.writeFile(concatFile, normalized.map((item) => `file '${path.resolve(item).replaceAll("'", "''")}'`).join("\n"), "utf8");
    const temporaryFinal = path.join(directory, `.instagram_reel.${crypto.randomUUID()}.tmp.mp4`);
    try {
      await this.command(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", temporaryFinal]);
      const stat = await fs.stat(temporaryFinal);
      if (stat.size <= 0) throw new MediaToolError("failed", "Final output is empty.");
      await fs.rename(temporaryFinal, finalPath);
    } finally { await fs.unlink(temporaryFinal).catch(() => undefined); }
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
  async mixBackgroundMusic(inputPath: string, bgmPath: string, volume: number, fadeSeconds: number, outputPath: string): Promise<void> {
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
      await this.command(["ffmpeg", "-y", "-i", inputPath, "-stream_loop", "-1", "-i", bgmPath, "-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", temporary]);
      const stat = await fs.stat(temporary);
      if (stat.size <= 0) throw new MediaToolError("failed", "BGM mix output is empty.");
      await fs.rename(temporary, outputPath);
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
}
