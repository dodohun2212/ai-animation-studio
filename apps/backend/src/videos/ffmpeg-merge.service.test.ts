import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FfmpegMergeEngine, MediaToolError, type MediaCommandRunner, type MergeSceneInput } from "./ffmpeg-merge.service.js";
import { escapeForFfmpegFilterPath } from "./subtitle-file.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

/**
 * Snapshots the subtitle files each ffmpeg call can see, at the moment it runs.
 *
 * The merge deletes `normalized/` once the final file exists — it is a cache, and a second full-size copy of
 * every finished video is not something to leave in a person's data folder. These tests were reading the .ass
 * files out of that directory *after* the merge, so they depended on debris surviving rather than on what the
 * merge did. Same assertions, read at the only moment they are actually true.
 */
async function captureAss(target: string, into: Map<string, string>): Promise<void> {
  const directory = path.dirname(target);
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  for (const name of names.filter((item) => item.endsWith(".ass"))) {
    into.set(name, await fs.readFile(path.join(directory, name), "utf8"));
  }
}

function runner(calls: string[][], ass: Map<string, string> = new Map()): MediaCommandRunner {
  return async (arguments_) => {
    const args = [...arguments_]; calls.push(args);
    await captureAss(args.at(-1)!, ass);
    await fs.writeFile(args.at(-1)!, Buffer.from("rendered"));
    return { stdout: "", stderr: "" };
  };
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-merge-")); roots.push(root);
  return { root, finalPath: path.join(root, "videos", "final", "instagram_reel.mp4"), fontsDir: path.join(root, "fonts") };
}

describe("FfmpegMergeEngine.merge narration audio mixing", () => {
  it("uses anullsrc silence when a scene has no narration file, unchanged from before narration existed", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    await engine.merge([{ clip: "scene1.mp4" }], 5, finalPath, "9:16");
    const normalizeCall = calls.find((args) => args.includes("scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"))!;
    expect(normalizeCall).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(normalizeCall).not.toContain("apad");
  });

  it("mixes in a real narration file with apad instead of anullsrc when one is given for a scene", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    await engine.merge([{ clip: "scene1.mp4", narrationAudioPath: "scene1_narration.mp3" }], 5, finalPath, "9:16");
    const normalizeCall = calls.find((args) => args[0] === "ffmpeg" && args.includes("scene1_narration.mp3"))!;
    expect(normalizeCall).toBeDefined();
    expect(normalizeCall).toContain("scene1_narration.mp3");
    expect(normalizeCall).toContain("[1:a]apad[aout]");
    expect(normalizeCall).toContain("[aout]");
    expect(normalizeCall).not.toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(normalizeCall).toContain("-shortest");
  });

  it("mixes real narration and silent fallback independently per scene in a multi-scene merge", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    const scenes: MergeSceneInput[] = [{ clip: "scene1.mp4", narrationAudioPath: "scene1_narration.mp3" }, { clip: "scene2.mp4" }];
    await engine.merge(scenes, 5, finalPath, "16:9");
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls).toHaveLength(2);
    expect(normalizeCalls[0]).toContain("scene1_narration.mp3");
    expect(normalizeCalls[1]).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
  });
});

describe("FfmpegMergeEngine.merge subtitle burn-in", () => {
  /**
   * The normalized clips are a cache, and a failed merge is the one time they are not.
   *
   * Nothing reads them back and every merge rewrites them, so after a successful run they are a second
   * full-size copy of the finished video sitting in the person's own data folder — 12-13MB per Episode, on a
   * machine that also keeps every clip it has ever paid for. After a failed run they are the only record of
   * what the run actually produced: deleting them there would not cost something rebuildable, it would cost
   * the way to see why it broke.
   *
   * Asserted as a pair because either half alone is satisfied by doing nothing, or by always deleting.
   */
  it("clears the normalized cache once the final file exists", async () => {
    const { root, finalPath, fontsDir } = await setup();
    await new FfmpegMergeEngine(runner([]), fontsDir).merge([{ clip: "scene1.mp4" }, { clip: "scene2.mp4" }], 5, finalPath, "9:16");

    await expect(fs.stat(finalPath)).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, "videos", "final", "normalized"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the normalized cache when the merge failed, because that is what shows why", async () => {
    const { root, finalPath, fontsDir } = await setup();
    const failing: MediaCommandRunner = async (args) => {
      const list = [...args];
      if (list.includes("concat")) throw new MediaToolError("failed", "concat failed");
      await fs.writeFile(list.at(-1)!, Buffer.from("rendered"));
      return { stdout: "", stderr: "" };
    };

    // Asserted as the merge's own error, not merely "something threw": the first version of this test had no
    // MediaToolError import at all and passed on the ReferenceError that produced.
    await expect(new FfmpegMergeEngine(failing, fontsDir).merge([{ clip: "scene1.mp4" }], 5, finalPath, "9:16")).rejects.toBeInstanceOf(MediaToolError);

    await expect(fs.stat(path.join(root, "videos", "final", "normalized", "scene1.mp4"))).resolves.toBeTruthy();
    await expect(fs.stat(finalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes a scene ASS file and appends the subtitles filter only for a scene with subtitle text", async () => {
    const calls: string[][] = [];
    const { root, finalPath, fontsDir } = await setup();
    const assFiles = new Map<string, string>();
    const engine = new FfmpegMergeEngine(runner(calls, assFiles), fontsDir);
    const scenes: MergeSceneInput[] = [
      { clip: "scene1.mp4", narrationAudioPath: "scene1_narration.mp3", subtitleText: "첫 번째 문장입니다." },
      { clip: "scene2.mp4" },
    ];
    await engine.merge(scenes, 5, finalPath, "9:16");

    const ass = assFiles.get("scene1.ass")!;
    expect(ass).toContain("첫 번째 문장입니다.");
    expect(ass).toContain("PlayResX: 1080");

    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls[0]!.find((arg) => arg.includes("subtitles="))).toBeDefined();
    expect(normalizeCalls[1]!.find((arg) => arg.includes("subtitles="))).toBeUndefined();
    expect(assFiles.has("scene2.ass")).toBe(false);
  });

  it("passes the fonts directory to the subtitles filter's fontsdir option", async () => {
    const calls: string[][] = [];
    const { finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    await engine.merge([{ clip: "scene1.mp4", narrationAudioPath: "a.mp3", subtitleText: "문장" }], 5, finalPath, "9:16");
    const filterArg = calls.find((args) => args[0] === "ffmpeg" && args.includes("-vf"))!.find((arg) => arg.includes("subtitles="))!;
    expect(filterArg).toContain(`fontsdir='${escapeForFfmpegFilterPath(fontsDir)}'`);
  });
});

describe("FfmpegMergeEngine.mixBackgroundMusic", () => {
  function probeThenWriteRunner(durationSeconds: number, calls: string[][]): MediaCommandRunner {
    return async (arguments_) => {
      const args = [...arguments_]; calls.push(args);
      if (args[0] === "ffprobe") return { stdout: JSON.stringify({ format: { duration: String(durationSeconds) } }), stderr: "" };
      await fs.writeFile(args.at(-1)!, Buffer.from("mixed"));
      return { stdout: "", stderr: "" };
    };
  }

  it("loops the bgm input, trims it to the merged video's own duration, fades both ends, applies volume, and mixes without amix's own normalization", async () => {
    const calls: string[][] = [];
    const { root } = await setup();
    const inputPath = path.join(root, "instagram_reel.mp4");
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, Buffer.from("existing final"));
    const outputPath = path.join(root, "mixed.mp4");
    const engine = new FfmpegMergeEngine(probeThenWriteRunner(20, calls));

    await engine.mixBackgroundMusic(inputPath, "bgm.mp3", 0.4, 2, outputPath);

    const ffmpegCall = calls.find((args) => args[0] === "ffmpeg")!;
    expect(ffmpegCall).toContain("-stream_loop");
    expect(ffmpegCall[ffmpegCall.indexOf("-stream_loop") + 1]).toBe("-1");
    expect(ffmpegCall[ffmpegCall.indexOf("-stream_loop") + 2]).toBe("-i");
    expect(ffmpegCall[ffmpegCall.indexOf("-stream_loop") + 3]).toBe("bgm.mp3");
    const filter = ffmpegCall[ffmpegCall.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("atrim=0:20.000");
    expect(filter).toContain("afade=t=in:st=0:d=2.000");
    expect(filter).toContain("afade=t=out:st=18.000:d=2.000"); // fades out starting 2s before the 20s end
    expect(filter).toContain("volume=0.4");
    expect(filter).toContain("amix=inputs=2:duration=first:dropout_transition=0:normalize=0");
    expect(ffmpegCall).toContain("-c:v"); expect(ffmpegCall[ffmpegCall.indexOf("-c:v") + 1]).toBe("copy");
    await expect(fs.readFile(outputPath, "utf8")).resolves.toBe("mixed");
    await expect(fs.readFile(inputPath, "utf8")).resolves.toBe("existing final"); // never overwritten mid-command
  });

  it("clamps a fadeSeconds longer than half the video to avoid negative fade-out timing on a very short clip", async () => {
    const calls: string[][] = [];
    const { root } = await setup();
    const inputPath = path.join(root, "instagram_reel.mp4");
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, Buffer.from("existing final"));
    const engine = new FfmpegMergeEngine(probeThenWriteRunner(3, calls));

    await engine.mixBackgroundMusic(inputPath, "bgm.mp3", 0.25, 10, path.join(root, "mixed.mp4"));

    const filter = calls.find((args) => args[0] === "ffmpeg")![calls.find((args) => args[0] === "ffmpeg")!.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("afade=t=in:st=0:d=1.500"); // clamped to half of the 3s duration
    expect(filter).toContain("afade=t=out:st=1.500:d=1.500");
  });

  it("reports an unusable input the same way an invalid clip is reported elsewhere", async () => {
    const { root } = await setup();
    const engine = new FfmpegMergeEngine(async (arguments_) => {
      if (arguments_[0] === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "not-a-number" } }), stderr: "" };
      throw new Error("should not reach ffmpeg");
    });
    await expect(engine.mixBackgroundMusic(path.join(root, "in.mp4"), "bgm.mp3", 0.25, 2, path.join(root, "out.mp4")))
      .rejects.toMatchObject({ kind: "invalid" });
  });
});
