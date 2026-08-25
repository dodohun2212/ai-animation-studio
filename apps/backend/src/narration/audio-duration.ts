import { runMediaCommand, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";

type ProbeFormat = { format?: { duration?: unknown } };

/** Real audio length via ffprobe, or undefined if the file is missing, unreadable, or ffprobe itself is unavailable — the local fake-mode placeholder file falls into this case too, since it has no valid audio stream to measure. */
export async function probeAudioDurationSeconds(file: string, runner: MediaCommandRunner = runMediaCommand): Promise<number | undefined> {
  try {
    const result = await runner(["ffprobe", "-v", "error", "-show_format", "-of", "json", file]);
    const data = JSON.parse(result.stdout) as ProbeFormat;
    const duration = Number(data.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  } catch {
    return undefined;
  }
}
