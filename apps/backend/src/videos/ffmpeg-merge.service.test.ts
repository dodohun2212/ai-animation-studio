import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FfmpegMergeEngine, type MediaCommandRunner } from "./ffmpeg-merge.service.js";

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
  return { root, finalPath: path.join(root, "videos", "final", "instagram_reel.mp4") };
}

describe("FfmpegMergeEngine.merge narration mixing", () => {
  it("uses anullsrc silence when a scene has no narration file, unchanged from before narration existed", async () => {
    const calls: string[][] = [];
    const { finalPath } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls));
    await engine.merge(["scene1.mp4"], [null], finalPath, "9:16");
    const normalizeCall = calls.find((args) => args.includes("scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"))!;
    expect(normalizeCall).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(normalizeCall).not.toContain("apad");
  });

  it("mixes in a real narration file with apad instead of anullsrc when one is given for a scene", async () => {
    const calls: string[][] = [];
    const { finalPath } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls));
    await engine.merge(["scene1.mp4"], ["scene1_narration.mp3"], finalPath, "9:16");
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
    const { finalPath } = await setup();
    const engine = new FfmpegMergeEngine(runner(calls));
    await engine.merge(["scene1.mp4", "scene2.mp4"], ["scene1_narration.mp3", null], finalPath, "16:9");
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls).toHaveLength(2);
    expect(normalizeCalls[0]).toContain("scene1_narration.mp3");
    expect(normalizeCalls[1]).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
  });
});
