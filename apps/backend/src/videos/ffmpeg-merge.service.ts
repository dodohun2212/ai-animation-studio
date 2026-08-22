import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";

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

/** Small injectable engine mirroring Python FFmpegEngine's probe/normalize/concat sequence. */
export class FfmpegMergeEngine {
  constructor(private readonly runner: MediaCommandRunner = runMediaCommand) {}

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

  async merge(clips: readonly string[], finalPath: string, ratio: unknown): Promise<void> {
    const [width, height] = outputSize(ratio);
    const directory = path.dirname(finalPath);
    const normalizedDirectory = path.join(directory, "normalized");
    await fs.mkdir(normalizedDirectory, { recursive: true });
    const normalized: string[] = [];
    const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`;
    for (const [index, clip] of clips.entries()) {
      const target = path.join(normalizedDirectory, `scene${index + 1}.mp4`);
      await this.command(["ffmpeg", "-y", "-i", clip, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v:0", "-map", "1:a:0", "-vf", filter, "-c:v", "libx264", "-c:a", "aac", "-shortest", target]);
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
}
