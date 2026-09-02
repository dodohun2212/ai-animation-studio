import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FfmpegMergeEngine, runMediaCommand } from "./ffmpeg-merge.service.js";

/**
 * Whether the music that lands on the video is the part of the song someone chose.
 *
 * The argument is easy to check and proves nothing: `-ss` can sit in the command and still be read after the
 * decode, or land after `-stream_loop` and be dropped on the second pass, and the video would come out with
 * the opening bars either way. Nothing in the app can hear the result, so this renders one and measures it.
 *
 * The track is built to make the answer audible: silence for the first five seconds, then a tone. Starting at
 * 0 must give a silent opening; starting at 5 must give a loud one. Loudness is read with `volumedetect`,
 * which is the same instrument the narration length work used.
 */
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function meanVolumeDb(file: string, from: number, seconds: number): Promise<number> {
  const { stderr } = await runMediaCommand(["ffmpeg", "-ss", String(from), "-t", String(seconds), "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const measured = /mean_volume: (-?\d+(?:.\d+)?) dB/.exec(stderr);
  if (!measured) throw new Error(`no mean_volume in: ${stderr.slice(-400)}`);
  return Number(measured[1]);
}

describe("where the music starts", () => {
  it("plays the part of the track that was asked for, not the part it opens with", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bgm-start-")); roots.push(root);
    const track = path.join(root, "track.m4a");
    // Five seconds of silence, then five of a tone: a song whose good part is not at the front.
    // `d=5` on the source, not `-t 5` after it: placed there it applies to the *next* input, leaving anullsrc
    // infinite and the concat waiting forever. Measured — the first version of this test hung for three minutes.
    await runMediaCommand(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=5",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=5",
      "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-c:a", "aac", track]);
    const silent = path.join(root, "silent.mp4");
    await runMediaCommand(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=320x240:r=30:d=4",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=4", "-c:v", "libx264", "-c:a", "aac", "-shortest", silent]);
    const engine = new FfmpegMergeEngine();

    const fromStart = path.join(root, "from-start.mp4");
    await fs.copyFile(silent, fromStart);
    await engine.mixBackgroundMusic(fromStart, track, 1, 0, fromStart);

    const fromFive = path.join(root, "from-five.mp4");
    await fs.copyFile(silent, fromFive);
    await engine.mixBackgroundMusic(fromFive, track, 1, 0, fromFive, 5);

    const openingWithoutSeek = await meanVolumeDb(fromStart, 0, 2);
    const openingWithSeek = await meanVolumeDb(fromFive, 0, 2);
    // The whole feature in one comparison: the same track, the same video, 30 dB apart in the first two seconds.
    expect(openingWithSeek).toBeGreaterThan(openingWithoutSeek + 30);
    expect(openingWithoutSeek).toBeLessThan(-80); // the song's own silence, carried through
  }, 180000);
});
