import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FfmpegMergeEngine, type MediaCommandRunner, type MergeSceneInput } from "./ffmpeg-merge.service.js";
import { escapeForFfmpegFilterPath } from "./subtitle-file.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function runner(calls: string[][]): MediaCommandRunner {
  return async (arguments_) => {
    const args = [...arguments_]; calls.push(args);
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
  it("writes a scene ASS file and appends the subtitles filter only for a scene with subtitle text", async () => {
    const calls: string[][] = [];
    const { root, finalPath, fontsDir } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls), fontsDir);
    const scenes: MergeSceneInput[] = [
      { clip: "scene1.mp4", narrationAudioPath: "scene1_narration.mp3", subtitleText: "첫 번째 문장입니다." },
      { clip: "scene2.mp4" },
    ];
    await engine.merge(scenes, 5, finalPath, "9:16");

    const assPath = path.join(root, "videos", "final", "normalized", "scene1.ass");
    const ass = await fs.readFile(assPath, "utf8");
    expect(ass).toContain("첫 번째 문장입니다.");
    expect(ass).toContain("PlayResX: 1080");

    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls[0]!.find((arg) => arg.includes("subtitles="))).toBeDefined();
    expect(normalizeCalls[1]!.find((arg) => arg.includes("subtitles="))).toBeUndefined();
    await expect(fs.stat(path.join(root, "videos", "final", "normalized", "scene2.ass"))).rejects.toThrow();
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
