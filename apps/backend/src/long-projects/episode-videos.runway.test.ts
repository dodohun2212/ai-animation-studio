import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { RUNWAY_POLL_INTERVAL_SECONDS } from "../videos/runway-workflow-support.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };

async function setupWithConnectedRunway(episodeDurationSeconds: 30 | 60 = 30, aspectRatio: "9:16" | "16:9" = "9:16") {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-videos-runway-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings: { ...settings, clipDurationSeconds: episodeDurationSeconds === 60 ? 10 : 5, aspectRatio } });
  const outline = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); await scripts.generate("long", 1, { userRequestId: "episode-videos.runway-script-1" }); await scripts.approve("long", 1, { approved: true });
  await approveEpisodeMappingReview(projectsRoot, root, "long", 1);
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

afterEach(async () => {
  vi.unstubAllGlobals();
  // Matches local-video-workflow.runway.test.ts's identical afterEach: without this, a fake-timer test earlier in
  // this file leaves vi.useFakeTimers() active for whichever test runs next, silently starving any real setTimeout
  // (including project-lock.ts's own retry loop) — the race test below only needs real timers and hung until this
  // was added, purely from running after an unrelated fake-timer test, not from anything wrong in that test itself.
  vi.useRealTimers();
  if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined;
});

/** Routes fetch calls by URL: POST submit -> a fresh task id; GET task -> RUNNING on the 1st check, SUCCEEDED after; GET output URL -> fixed bytes. */
/** What the mock "downloads". Distinct from the local placeholder so a test can tell which one was written. */
const RUNWAY_BODY = Buffer.concat([Buffer.from("000000186674797069736F6D", "hex"), Buffer.from("real runway output bytes for this scene")]);

function runwayFetchMock(options: { failTaskId?: string } = {}) {
  const checkCounts = new Map<string, number>();
  let nextTaskId = 1;
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    void init;
    const url = String(input);
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
      // Longer than the placeholder on purpose: a body no bigger than a bare header is refused now, and a mock
      // that returned one would be testing the refusal instead of the download.
      const bytes = RUNWAY_BODY;
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

  it("submits every scene with duration: 10 for a 60-second Episode, not the 5-second default", async () => {
    const deps = await setupWithConnectedRunway(60);
    const videos = newVideos(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const preview = await videos.preview("long", 1);
    expect(preview.durationSecondsPerScene).toBe(10);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);

    const submitCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/v1/image_to_video"))!;
    expect(JSON.parse(String((submitCall[1] as RequestInit).body))).toMatchObject({ duration: 10 });
  });

  it("submits with ratio: 1280:720 for a 16:9 Episode, not the 720:1280 default — the actual submission, not just preview", async () => {
    const deps = await setupWithConnectedRunway(30, "16:9");
    const videos = newVideos(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const preview = await videos.preview("long", 1);
    expect(preview.ratio).toBe("1280:720");
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);

    const submitCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/v1/image_to_video"))!;
    expect(JSON.parse(String((submitCall[1] as RequestInit).body))).toMatchObject({ ratio: "1280:720" });
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

  it("never double-submits the same scene when two independent service instances race — the shape of a nest-watch dev-server restart, not just a same-process double call", async () => {
    // docs/06_DECISIONS.md D-005: the same in-memory `advancing` Set race local-video-workflow.service.ts
    // already had a confirmed real-money incident for (Round 152) existed here too, just never fixed — see
    // episode-videos.service.ts's advanceReal() doc comment. Two separate EpisodeVideosService instances against
    // the same on-disk project reproduce a nest-watch restart's brief process overlap without spawning two
    // actual OS processes, mirroring local-video-workflow.runway.test.ts's identical test for the short-project side.
    const deps = await setupWithConnectedRunway();
    const first = newVideos(deps);
    const second = newVideos(deps);
    let resolveStalledSubmit: (value: unknown) => void = () => {};
    let notifyReachedSubmit: () => void = () => {};
    const reachedSubmit = new Promise<void>((resolve) => { notifyReachedSubmit = resolve; });
    let submitCalls = 0;
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    void init;
    const url = String(input);
      if (url.endsWith("/v1/image_to_video")) {
        submitCalls += 1;
        if (submitCalls === 1) { notifyReachedSubmit(); return new Promise((resolve) => { resolveStalledSubmit = resolve; }); }
        return { ok: true, status: 200, json: async () => ({ id: `task-${submitCalls}` }), headers: { get: () => null } } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const preview = await first.preview("long", 1);
    const started = await first.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });

    const firstRun = first.run("long", 1, started.jobId);
    // Whichever instance's call reaches fetch first stalls here, still holding the file lock.
    await reachedSubmit;
    let secondSettled = false;
    const secondRun = second.run("long", 1, started.jobId).finally(() => { secondSettled = true; }); // a "second process" racing in
    // Real wait so `second`'s own chain (fresh read, lock-acquisition attempt, retry loop) reaches and blocks
    // on the lock before it is released, then checked rather than assumed on the next line.
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The wait alone cannot prove the race happened — on a slow enough machine `second` might not have reached
    // the lock yet, and the test would then pass for the weaker reason that nothing raced at all. Scene 1 is not
    // running yet (`first` is still stalled inside submit and has written nothing), so the only thing that can
    // be keeping `second` from finishing is the lock. Still pending is the premise; settled means no race.
    expect(secondSettled).toBe(false);
    resolveStalledSubmit({ ok: true, status: 200, json: async () => ({ id: "task-1" }), headers: { get: () => null } });
    await Promise.all([firstRun, secondRun]);

    expect(submitCalls).toBe(1); // `second` was blocked on the file lock until `first` finished, then saw scene 1 already running and never submitted its own
    const progress = await first.progress("long", 1, started.jobId);
    expect(progress.status).toBe("running");
    expect(progress.currentSceneNumber).toBe(1);
    first.onModuleDestroy(); second.onModuleDestroy();
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

  it("writes what Runway sent, not the local placeholder", async () => {
    // This is what a real cycle produced: six clips charged at $0.25, six records reading "succeeded" with real
    // task ids, and six 32-byte files on disk — byte-identical to the local fake constant. The download had
    // arrived and was thrown away. Nothing caught it because the stub satisfies validVideo, which only looks
    // for a length and an `ftyp` box.
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    vi.stubGlobal("fetch", runwayFetchMock());
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "bytes_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await videos.progress("long", 1, started.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await videos.progress("long", 1, started.jobId);

    const file = path.join(deps.projectsRoot, "long", "long_story", "Episode01", "videos", "scene1.mp4");
    expect(await fs.readFile(file)).toEqual(RUNWAY_BODY);
  });

  it("fails a scene whose download is no bigger than a bare header instead of calling it done", async () => {
    // An mp4 that is only a header is not a video, and recording it as succeeded is what let the placeholder
    // pass for six paid clips. Refusing leaves the scene regenerable; accepting moved the Episode to review
    // with nothing to review.
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    const empty = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/v1/image_to_video")) return { ok: true, status: 200, json: async () => ({ id: "task-1" }), headers: { get: () => null } } as unknown as Response;
      if (url.includes("/v1/tasks/")) return { ok: true, status: 200, json: async () => ({ id: "task-1", status: "SUCCEEDED", output: ["https://cdn.runway/task-1.mp4"] }), headers: { get: () => null } } as unknown as Response;
      return { ok: true, status: 200, arrayBuffer: async () => empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.byteLength), headers: { get: () => null } } as unknown as Response;
    }));
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "empty_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    const progress = await videos.progress("long", 1, started.jobId);

    expect(progress).toMatchObject({ status: "failed", failedSceneNumbers: [1] });
    expect(progress.episode.status).not.toBe("videos_review");
  });

  it("fetches the clips already paid for instead of buying them again", async () => {
    // Exactly the state a real cycle left behind: six charges on the ledger, six records succeeded with task
    // ids, six placeholder files. Recovery asks Runway for those tasks' outputs — a read, not a generation —
    // so nothing new reaches the ledger.
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "recover_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    for (let scene = 1; scene <= 6; scene++) {
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      await videos.progress("long", 1, started.jobId);
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      await videos.progress("long", 1, started.jobId);
    }

    // Put the damage back: overwrite every clip with the placeholder the old code wrote.
    const placeholder = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");
    const file = (scene: number) => path.join(deps.projectsRoot, "long", "long_story", "Episode01", "videos", `scene${scene}.mp4`);
    for (let scene = 1; scene <= 6; scene++) await fs.writeFile(file(scene), placeholder);

    const spendBefore = await deps.budget.spentThisMonth();
    const submitsBefore = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video")).length;

    const result = await videos.recover("long", 1, started.jobId, { approved: true });

    expect(result.recoveredSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.unrecoverableScenes).toEqual([]);
    expect(await fs.readFile(file(1))).toEqual(RUNWAY_BODY);
    // No new task, and no new charge: the whole point.
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video")).length).toBe(submitsBefore);
    expect(await deps.budget.spentThisMonth()).toBe(spendBefore);
  });

  it("leaves a scene whose output can no longer be fetched failed, rather than buying it again", async () => {
    // An expired URL is the reason this is urgent. Regenerating on its own would spend money the person never
    // agreed to spend, so the scene is reported and left for them to decide about.
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "recover_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    for (let scene = 1; scene <= 6; scene++) {
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      await videos.progress("long", 1, started.jobId);
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      await videos.progress("long", 1, started.jobId);
    }
    const placeholder = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");
    const file = (scene: number) => path.join(deps.projectsRoot, "long", "long_story", "Episode01", "videos", `scene${scene}.mp4`);
    for (let scene = 1; scene <= 6; scene++) await fs.writeFile(file(scene), placeholder);

    const submitsBefore = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video")).length;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/v1/tasks/")) return { ok: true, status: 200, json: async () => ({ id: "t", status: "SUCCEEDED", output: ["https://cdn.runway/gone.mp4"] }), headers: { get: () => null } } as unknown as Response;
      if (url.startsWith("https://cdn.runway/")) return { ok: false, status: 404, json: async () => ({}), text: async () => "expired", headers: { get: () => null } } as unknown as Response;
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const result = await videos.recover("long", 1, started.jobId, { approved: true });
    expect(result.recoveredSceneNumbers).toEqual([]);
    expect(result.unrecoverableScenes.map((item) => item.sceneNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await fs.readFile(file(1))).toEqual(placeholder);
    expect(submitsBefore).toBe(6);
  });

  it("does not re-write the placeholder when recovery itself comes back empty", async () => {
    // The failure mode this whole recovery exists to undo, arriving through the recovery path: a URL that still
    // answers but hands back a header and nothing else. Writing it would restore the exact state we are here to
    // fix, and mark it succeeded again.
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    vi.stubGlobal("fetch", runwayFetchMock());
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "recover_3", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    for (let scene = 1; scene <= 6; scene++) {
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      await videos.progress("long", 1, started.jobId);
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      await videos.progress("long", 1, started.jobId);
    }
    const placeholder = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");
    const file = (scene: number) => path.join(deps.projectsRoot, "long", "long_story", "Episode01", "videos", `scene${scene}.mp4`);
    for (let scene = 1; scene <= 6; scene++) await fs.writeFile(file(scene), placeholder);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/v1/tasks/")) return { ok: true, status: 200, json: async () => ({ id: "t", status: "SUCCEEDED", output: ["https://cdn.runway/stub.mp4"] }), headers: { get: () => null } } as unknown as Response;
      return { ok: true, status: 200, arrayBuffer: async () => placeholder.buffer.slice(placeholder.byteOffset, placeholder.byteOffset + placeholder.byteLength), headers: { get: () => null } } as unknown as Response;
    }));

    const result = await videos.recover("long", 1, started.jobId, { approved: true });
    expect(result.recoveredSceneNumbers).toEqual([]);
    expect(result.unrecoverableScenes.every((item) => item.reason === "empty_output")).toBe(true);
    // Reported as failed, not left reading "succeeded" over a stub — that is how this went unnoticed the first time.
    expect(result.failedSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("serves a scene's clip for a player, and refuses to serve a placeholder", async () => {
    // The Episode review screen had no address to point a <video> at, so its cards showed a status and a
    // filename — and six 32-byte stubs were approved through it. Serving a placeholder would draw an empty
    // player, which is the same claim the stub made on disk, so it is refused rather than streamed.
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    vi.stubGlobal("fetch", runwayFetchMock());
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "content_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await videos.progress("long", 1, started.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await videos.progress("long", 1, started.jobId);

    const file = path.join(deps.projectsRoot, "long", "long_story", "Episode01", "videos", "scene1.mp4");
    await expect(videos.content("long", 1, "1")).resolves.toEqual({ path: file });

    const placeholder = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");
    await fs.writeFile(file, placeholder);
    await expect(videos.content("long", 1, "1")).rejects.toMatchObject({ response: { code: "LONG_EPISODE_VIDEOS_INVALID" } });
    // And a scene number the Episode does not have is refused rather than reaching the filesystem.
    await expect(videos.content("long", 1, "99")).rejects.toMatchObject({ response: { code: "LONG_EPISODE_VIDEOS_INVALID" } });
  });

  it("keeps the Episode clip the month was already charged for when the ledger goes unreadable mid-job, and says the total is short", async () => {
    // Scene 1 is running on Runway, the ledger becomes unreadable, the task then succeeds — the bytes are
    // downloaded, so the money is gone before the ledger write is even attempted. Three things used to go wrong
    // together here: the clip was discarded, nothing was said, and the progress poll itself died on the same
    // file while trying to report a retry cost.
    const deps = await setupWithConnectedRunway();
    const videos = newVideos(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_ledger", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId); // scene 1 submitted while the ledger was still fine
    await fs.writeFile(path.join(deps.root, "runway_budget_usage.json"), "{ this is not the ledger");

    // Two polls: this mock answers RUNNING on a task's first check and SUCCEEDED after.
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await videos.progress("long", 1, started.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    const progress = await videos.progress("long", 1, started.jobId);

    // The clip is kept, on disk and in the record.
    const episodeDirectory = path.join(deps.projectsRoot, "long", "long_story", "Episode01");
    expect(await fs.readFile(path.join(episodeDirectory, "videos", "scene1.mp4"))).toEqual(RUNWAY_BODY);
    expect(progress.completedSceneNumbers).toContain(1);

    // And it is said in both places an Episode's warnings are read from.
    const episode = JSON.parse(await fs.readFile(path.join(episodeDirectory, "project.json"), "utf8")) as { warnings?: string[] };
    const outlines = JSON.parse(await fs.readFile(path.join(deps.projectsRoot, "long", "long_story", "episode_outlines.json"), "utf8")) as Array<{ warnings?: string[] }>;
    for (const warnings of [episode.warnings, outlines[0]!.warnings]) {
      const warning = warnings?.find((item) => item.includes("runway_budget_usage.json"));
      expect(warning).toContain("1번 장면");
      expect(warning).toContain("다시 만들지 마시고");
    }

    // Scene 2 is refused rather than bought, and the refusal is *recorded* — the frontend already has a sentence
    // for this scene error; before this, only a poll ever saw it and a timer tick swallowed it entirely.
    expect(progress.sceneErrors?.[2]).toBe("budget_ledger_unreadable");
    // The poll survives: it reads the ledger only for the retry cost line, and that line is what gives way.
    expect(progress.retryEstimate).toBeUndefined();
  });

});
