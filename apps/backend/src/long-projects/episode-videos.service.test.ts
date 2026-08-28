import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
async function setup(episodeDurationSeconds: 30 | 60 = 30, aspectRatio: "9:16" | "16:9" = "9:16") {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-videos-")); const projectsRoot = path.join(root, "projects"); const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings: { ...settings, clipDurationSeconds: episodeDurationSeconds === 60 ? 10 : 5, aspectRatio } }); const outline = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); await scripts.generate("long", 1, {}); await scripts.approve("long", 1, { approved: true });
  await approveEpisodeMappingReview(projectsRoot, root, "long", 1);
  const images = new EpisodeImagesService(projectsRoot); await images.generate("long", 1, { approved: true }); for (const number of [1, 2, 3, 4, 5, 6] as const) await images.approve("long", 1, String(number), { approved: true });
  return { videos: new EpisodeVideosService(projectsRoot), projectsRoot };
}
afterEach(async () => { vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeVideosService", () => {
  it("keeps preview provider-free, requires its exact approval snapshot, and produces six local fake clips sequentially", async () => {
    const { videos, projectsRoot } = await setup(); const preview = await videos.preview("long", 1);
    expect(preview).toMatchObject({ model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene: 5, executionMode: "sequential", estimatedCostUsd: 1.5 });
    await expect(videos.start("long", 1, { approved: true, confirmationId: "old", userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); await videos.run("long", 1, started.jobId);
    expect(started.episode.status).toBe("videos_generating"); const localFakeProgress = await videos.progress("long", 1, started.jobId); expect(localFakeProgress.completedSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]); expect(localFakeProgress.retryEstimate).toBeUndefined();
    await expect(fs.access(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "scene6.mp4"))).resolves.toBeUndefined();
    const repeated = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); expect(repeated.jobId).toBe(started.jobId);
  });

  it("derives ratio from the project's own aspectRatio setting (16:9 -> 1280:720) instead of always hardcoding vertical, and the prompt's orientation line follows it", async () => {
    const { videos } = await setup(30, "16:9");
    const preview = await videos.preview("long", 1);
    expect(preview.ratio).toBe("1280:720");
    expect(preview.scenes[0]!.prompt).toContain("horizontal");
  });

  it("includes motion_speed, motion_intensity, and expression_change in the video prompt — previously generated and stored but never read by any prompt builder", async () => {
    const { videos } = await setup();
    const preview = await videos.preview("long", 1);
    const prompt = preview.scenes[0]!.prompt;
    expect(prompt).toContain("Pacing: motion speed normal; intensity moderate");
    expect(prompt).toContain("Performance: focused to hopeful");
  });

  it("derives durationSecondsPerScene from the project's episodeDurationSeconds setting (60s project -> 10s/scene, matching Runway's only two valid clip lengths)", async () => {
    const { videos } = await setup(60);
    const preview = await videos.preview("long", 1);
    expect(preview.durationSecondsPerScene).toBe(10);
    expect(preview.scenes[0]!.prompt).toContain("10-second");
  });

  it("requires all video reviews and regenerates one scene while preserving the other approvals and history", async () => {
    const { videos, projectsRoot } = await setup(); const preview = await videos.preview("long", 1); const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); await videos.run("long", 1, started.jobId);
    for (const number of [1, 2, 3, 4, 5] as const) await videos.approve("long", 1, started.jobId, String(number), { approved: true });
    expect((await videos.review("long", 1, started.jobId)).episode.status).toBe("videos_review"); await videos.approve("long", 1, started.jobId, "6", { approved: true }); expect((await videos.review("long", 1, started.jobId)).episode.status).toBe("videos_approved");
    const regenerated = await videos.regenerate("long", 1, started.jobId, "3", { approved: true }); expect(regenerated.regeneratedSceneNumbers).toEqual([3]); expect((await videos.review("long", 1, started.jobId)).reviews.find((item) => item.sceneNumber === 3)?.status).toBe("pending");
    await expect(fs.readdir(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "history"))).resolves.toHaveLength(1);
  });

  it("never calls fetch across preview, start, run, progress, regenerate, and approve when no Runway credential/budget is wired in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { videos } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_3", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    await videos.progress("long", 1, started.jobId);
    await videos.regenerate("long", 1, started.jobId, "2", { approved: true });
    for (const number of [1, 2, 3, 4, 5, 6] as const) await videos.approve("long", 1, started.jobId, String(number), { approved: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
