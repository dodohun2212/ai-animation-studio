import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { RUNWAY_POLL_INTERVAL_SECONDS } from "../videos/runway-workflow-support.js";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, episodeDurationSeconds: 30, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "" };

async function setupWithConnectedRunway() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-videos-runway-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const outline = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); await scripts.generate("long", 1, {}); await scripts.approve("long", 1, { approved: true });
  const mappings = new EpisodeAssetMappingsService(projectsRoot, new LocalAssetsRepository(root)); const mapping = await mappings.begin("long", 1, { textOnlyConfirmed: true }); await mappings.approve("long", 1, { approved: true, scriptFingerprint: mapping.review.scriptFingerprint });
  const images = new EpisodeImagesService(projectsRoot); await images.generate("long", 1, { approved: true }); for (const number of [1, 2, 3, 4, 5, 6] as const) await images.approve("long", 1, String(number), { approved: true });

  const settingsRepository = new ProviderSettingsRepository(root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("runway", { value: "key_test_runway_1234567890" });
  const budget = new RunwayBudget(root, 10);
  return { root, projectsRoot, providerSettings, budget };
}

function newVideos(deps: Awaited<ReturnType<typeof setupWithConnectedRunway>>) {
  return new EpisodeVideosService(deps.projectsRoot, deps.providerSettings, deps.budget);
}

afterEach(async () => { vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

/** Routes fetch calls by URL: POST submit -> a fresh task id; GET task -> RUNNING on the 1st check, SUCCEEDED after; GET output URL -> fixed bytes. */
function runwayFetchMock(options: { failTaskId?: string } = {}) {
  const checkCounts = new Map<string, number>();
  let nextTaskId = 1;
  return vi.fn(async (url: string) => {
    if (url.endsWith("/v1/image_to_video")) {
      const taskId = `task-${nextTaskId++}`;
      return { ok: true, status: 200, json: async () => ({ id: taskId }), headers: { get: () => null } } as unknown as Response;
    }
    if (url.includes("/v1/tasks/")) {
      const taskId = url.split("/v1/tasks/")[1]!;
      if (taskId === options.failTaskId) return { ok: true, status: 200, json: async () => ({ id: taskId, status: "FAILED", failure: "content policy violation" }), headers: { get: () => null } } as unknown as Response;
      const count = (checkCounts.get(taskId) ?? 0) + 1; checkCounts.set(taskId, count);
      if (count === 1) return { ok: true, status: 200, json: async () => ({ id: taskId, status: "RUNNING" }), headers: { get: () => null } } as unknown as Response;
      return { ok: true, status: 200, json: async () => ({ id: taskId, status: "SUCCEEDED", output: [`https://cdn.runway/${taskId}.mp4`] }), headers: { get: () => null } } as unknown as Response;
    }
    if (url.startsWith("https://cdn.runway/")) {
      const bytes = Buffer.from("fake-mp4-bytes");
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), headers: { get: () => null } } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("real Runway episode video generation", () => {
  it("submits, polls through running-then-succeeded, and advances scene by scene to completion", async () => {
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    expect(started.episode.status).toBe("videos_generating");
    let progress = await videos.run("long", 1, started.jobId);
    expect(progress).toMatchObject({ status: "running", currentSceneNumber: 1 });

    for (let scene = 1; scene <= 6; scene++) {
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await videos.progress("long", 1, started.jobId); // 1st check: still running
      expect(progress.status).toBe("running");
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await videos.progress("long", 1, started.jobId); // 2nd check: succeeded, advances
    }

    expect(progress).toMatchObject({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    expect(progress.episode.status).toBe("videos_review");
  });

  it("halts at a scene Runway explicitly reports FAILED, without submitting later scenes, and lets the user regenerate it", async () => {
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    const fetchMock = runwayFetchMock({ failTaskId: "task-1" });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    const progress = await videos.progress("long", 1, started.jobId);
    expect(progress).toMatchObject({ status: "failed", failedSceneNumbers: [1] });
    expect(progress.sceneErrors).toEqual({ 1: "content policy violation" });
    const submitCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video")).length;
    expect(submitCalls).toBe(1); // scene 1 only — never skipped ahead to scene 2

    const regenerated = await videos.regenerate("long", 1, started.jobId, "1", { approved: true });
    expect(regenerated.status).toBe("running");
  });

  it("reflects real recorded spend from the shared RunwayBudget ledger instead of a hardcoded budget", async () => {
    const deps = await setupWithConnectedRunway();
    await deps.budget.record("some_other_project", 1, "video", true, 4);
    const videos = newVideos(deps);
    const preview = await videos.preview("long", 1);
    expect(preview.maximumProviderCalls).toBe(6);
    expect(preview.budget).toEqual({ monthlyLimitUsd: 10, spentUsd: 4, remainingUsd: 6, estimatedRequestCostUsd: 1.5, canSpend: true });
  });

  it("omits the budget field entirely when no RunwayBudget is wired (no provider connected)", async () => {
    const deps = await setupWithConnectedRunway();
    const videos = new EpisodeVideosService(deps.projectsRoot);
    const preview = await videos.preview("long", 1);
    expect(preview.maximumProviderCalls).toBe(6);
    expect(preview.budget).toBeUndefined();
  });

  it("reports a retry cost estimate reflecting real recorded spend during an in-progress Runway job", async () => {
    const deps = await setupWithConnectedRunway();
    await deps.budget.record("other-project", 1, "video", true, 4, new Date("2026-08-23T00:00:00.000Z"));
    const videos = newVideos(deps);
    const fetchMock = runwayFetchMock({ failTaskId: "task-1" });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    const progress = await videos.progress("long", 1, started.jobId);
    expect(progress.status).toBe("failed");
    // The recorded spend includes both the 4 injected above and scene 1's own real failed-attempt record (0.25) —
    // a failure still records estimated cost as actual, per RunwayBudget's own contract.
    expect(progress.retryEstimate).toEqual({
      perSceneCostUsd: 0.25,
      budget: { monthlyLimitUsd: 10, spentUsd: 4.25, remainingUsd: 5.75, estimatedRequestCostUsd: 0.25, canSpend: true },
    });
  });

  it("reports each scene's real recorded cost in the review response, accumulating across a regeneration, scoped per Episode", async () => {
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    let progress = await videos.run("long", 1, started.jobId);
    for (let scene = 1; scene <= 6; scene++) {
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await videos.progress("long", 1, started.jobId);
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await videos.progress("long", 1, started.jobId);
    }
    expect(progress.status).toBe("succeeded");

    const firstReview = await videos.review("long", 1, started.jobId);
    expect(firstReview.reviews.every((review) => review.costUsd === 0.25)).toBe(true);

    await videos.regenerate("long", 1, started.jobId, "1", { approved: true });
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await videos.progress("long", 1, started.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await videos.progress("long", 1, started.jobId);

    const secondReview = await videos.review("long", 1, started.jobId);
    expect(secondReview.reviews.find((review) => review.sceneNumber === 1)?.costUsd).toBeCloseTo(0.5, 8);
    expect(secondReview.reviews.filter((review) => review.sceneNumber !== 1).every((review) => review.costUsd === 0.25)).toBe(true);
  });
});
