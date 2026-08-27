import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MediaToolError, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideoMergeService } from "./episode-video-merge.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };

function runner(options: { invalidProbe?: boolean; unavailable?: boolean; noOutput?: boolean } = {}, calls: string[][] = []): MediaCommandRunner {
  return async (arguments_) => {
    const args = [...arguments_]; calls.push(args);
    if (options.unavailable) throw new MediaToolError("unavailable", "not installed");
    if (args[0] === "ffprobe") return { stdout: JSON.stringify(options.invalidProbe ? { streams: [], format: { duration: "0" } } : { streams: [{ codec_type: "video" }], format: { duration: "5" } }), stderr: "" };
    if (!options.noOutput) await fs.writeFile(args.at(-1)!, "rendered");
    return { stdout: "", stderr: "" };
  };
}

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-video-merge-")); const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot); await projects.create({ projectId: "long", settings });
  const outline = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); await scripts.generate("long", 1, {}); await scripts.approve("long", 1, { approved: true });
  const mappings = new EpisodeAssetMappingsService(projectsRoot, new LocalAssetsRepository(root)); const mapping = await mappings.begin("long", 1, { textOnlyConfirmed: true }); await mappings.approve("long", 1, { approved: true, scriptFingerprint: mapping.review.scriptFingerprint });
  const images = new EpisodeImagesService(projectsRoot); await images.generate("long", 1, { approved: true }); for (const number of [1, 2, 3, 4, 5, 6] as const) await images.approve("long", 1, String(number), { approved: true });
  const videos = new EpisodeVideosService(projectsRoot); const preview = await videos.preview("long", 1); const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); await videos.run("long", 1, started.jobId); for (const number of [1, 2, 3, 4, 5, 6] as const) await videos.approve("long", 1, started.jobId, String(number), { approved: true });
  return { projectsRoot };
}
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeVideoMergeService", () => {
  it("probes, normalizes, and concatenates the current six approved Episode clips in scene order without exposing disk paths", async () => {
    const { projectsRoot } = await setup(); const calls: string[][] = [];
    const result = await new EpisodeVideoMergeService(projectsRoot, runner({}, calls)).merge("long", 1);
    expect(result).toMatchObject({ finalVideoPath: "videos/final/instagram_reel.mp4", episode: { status: "completed" } });
    expect(JSON.stringify(result)).not.toContain(projectsRoot);
    expect(calls.filter((args) => args[0] === "ffprobe")).toHaveLength(6);
    expect(calls.filter((args) => args[0] === "ffmpeg")).toHaveLength(7);
    expect(calls.filter((args) => args[0] === "ffprobe").map((args) => path.basename(args.at(-1)!))).toEqual(["scene1.mp4", "scene2.mp4", "scene3.mp4", "scene4.mp4", "scene5.mp4", "scene6.mp4"]);
    expect(calls.find((args) => args.includes("-vf"))!).toContain("scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p");
    await expect(fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "final", "instagram_reel.mp4"), "utf8")).resolves.toBe("rendered");
  });

  it("requires one persisted current job and all six explicit approvals before changing the Episode state", async () => {
    const { projectsRoot } = await setup(); const reviews = path.join(projectsRoot, "long", "long_story", "Episode01", "generated_video_reviews.json");
    const values = JSON.parse(await fs.readFile(reviews, "utf8")) as Array<Record<string, unknown>>; values[5]!.status = "pending"; await fs.writeFile(reviews, JSON.stringify(values), "utf8");
    await expect(new EpisodeVideoMergeService(projectsRoot, runner()).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MERGE_CLIPS_INVALID" } });
    const project = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "project.json"), "utf8")) as { state: string }; expect(project.state).toBe("videos_approved");
    await expect(new EpisodeVideoMergeService(projectsRoot, runner()).merge("../long", 1)).rejects.toMatchObject({ response: { code: "UNSAFE_PROJECT_ID" } });
  });

  it("keeps approved clips and records a recoverable failed state when the mock media runner fails", async () => {
    const { projectsRoot } = await setup();
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({ noOutput: true })).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MERGE_FAILED" } });
    const project = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "project.json"), "utf8")) as { state: string; errors: string[] }; expect(project.state).toBe("failed"); expect(project.errors).toContain("Episode video rendering failed.");
    await expect(fs.stat(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "scene1.mp4"))).resolves.toBeTruthy();
    // A second attempt is allowed, and fails for the reason it actually fails for rather than being refused
    // as not-allowed. This line used to assert the refusal, which pinned the dead end as intended behaviour:
    // the merge is the only thing that writes `failed`, nothing was published when it did, and the approved
    // clips are still on disk one line above — there was never anything to do from there except try again.
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({ unavailable: true })).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_FFMPEG_UNAVAILABLE" } });
    // And it succeeds once the thing that broke is working, which is the whole point of letting it start.
    await expect(new EpisodeVideoMergeService(projectsRoot, runner()).merge("long", 1)).resolves.toMatchObject({ episode: { status: "completed" } });
  });

  it("reports unavailable and invalid probe errors without moving an approved Episode to rendering", async () => {
    const { projectsRoot } = await setup();
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({ unavailable: true })).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_FFMPEG_UNAVAILABLE" } });
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({ invalidProbe: true })).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MERGE_CLIPS_INVALID" } });
    const project = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "project.json"), "utf8")) as { state: string }; expect(project.state).toBe("videos_approved");
  });

  it("mixes in a scene's generated narration audio when narrationEnabled is on, and falls back to silence for the rest", async () => {
    const { projectsRoot } = await setup();
    const narrationFile = path.join(projectsRoot, "long", "long_story", "Episode01", "narration", "scene2.mp3");
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.writeFile(narrationFile, Buffer.from("fake narration audio"));
    const projects = new LongProjectsService(projectsRoot);
    await projects.updateSettings("long", { settings: { ...settings, narrationEnabled: true } });

    const calls: string[][] = [];
    await new EpisodeVideoMergeService(projectsRoot, runner({}, calls)).merge("long", 1);
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls).toHaveLength(6);
    expect(normalizeCalls[1]).toContain(narrationFile);
    for (const [index, call] of normalizeCalls.entries()) {
      if (index === 1) continue;
      expect(call).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    }
  });

  it("does not burn in any subtitle when subtitlesEnabled is off, even for a scene with real narration audio", async () => {
    const { projectsRoot } = await setup();
    const narrationFile = path.join(projectsRoot, "long", "long_story", "Episode01", "narration", "scene1.mp3");
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.writeFile(narrationFile, Buffer.from("fake narration audio"));
    const projects = new LongProjectsService(projectsRoot);
    await projects.updateSettings("long", { settings: { ...settings, narrationEnabled: true } }); // subtitlesEnabled stays off

    const calls: string[][] = [];
    await new EpisodeVideoMergeService(projectsRoot, runner({}, calls)).merge("long", 1);
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls[0]!.find((arg) => arg.includes("subtitles="))).toBeUndefined();
  });

  it("burns in a subtitle for a scene with narration text when subtitlesEnabled is on, independent of whether narration audio exists", async () => {
    const { projectsRoot } = await setup();
    // The pipeline is already past script_review by this point (setup() runs it all the way to videos_approved),
    // so scripts.update() would reject the edit — write the stored narration text directly, same as the "requires
    // one persisted current job" test above edits generated_video_reviews.json directly.
    const episodeProjectFile = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const stored = JSON.parse(await fs.readFile(episodeProjectFile, "utf8")) as { script: { scenes: Array<Record<string, unknown>> } };
    stored.script.scenes[0]!.narration = "장면 1 내레이션";
    await fs.writeFile(episodeProjectFile, JSON.stringify(stored, null, 2), "utf8");
    const projects = new LongProjectsService(projectsRoot);
    await projects.updateSettings("long", { settings: { ...settings, subtitlesEnabled: true } }); // narrationEnabled stays off — captions-only

    const calls: string[][] = [];
    await new EpisodeVideoMergeService(projectsRoot, runner({}, calls)).merge("long", 1);
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls[0]!.find((arg) => arg.includes("subtitles="))).toBeDefined();
    expect(normalizeCalls[0]).toContain("anullsrc=channel_layout=stereo:sample_rate=48000"); // no audio was ever generated
    const assContent = await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "final", "normalized", "scene1.ass"), "utf8");
    expect(assContent).toContain("장면 1 내레이션");
  });

  it("contains no provider or network client", async () => {
    // "runway" itself is allowed to appear as the execution_mode data tag a video record may already carry
    // (stamped upstream by episode-videos.service.ts once a scene's real generation succeeded) — this file only
    // ever reads already-downloaded local mp4 bytes off disk, regardless of how they got there. What must never
    // appear is an actual provider SDK/domain reference or a live network call.
    const source = await fs.readFile(path.join(process.cwd(), "src", "long-projects", "episode-video-merge.service.ts"), "utf8");
    expect(source).not.toMatch(/openai|runwayml\.com|runway-video-adapter|fetch\s*\(/i);
  });
});
