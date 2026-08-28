import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { RUNWAY_POLL_INTERVAL_SECONDS, SUBMIT_CLAIM_TIMEOUT_SECONDS } from "./runway-workflow-support.js";
import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";
import { LocalVideoWorkflowService } from "./local-video-workflow.service.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function scenes() { return [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `d${number}`, visual_action: "a", start_motion: "s", main_motion: "m", end_motion: "e", shot_size: "medium", camera_angle: "eye", composition: "center", lens_feel: "natural", focus_subject: "subject", camera_motion: "dolly", environment_motion: "wind", motion_speed: "normal", motion_intensity: "moderate", expression_change: "calm", continuity_hint: "continue" })); }

async function setupWithConnectedRunway() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-workflow-runway-")); roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("video_workflow", "topic", "2026-08-23T00:00:00.000Z");
  project.workflow_state = WorkflowState.WaitingForVideoConfirmation; project.scenes = scenes(); await projects.create(project);
  const images = path.join(projectsRoot, project.project_id, "images"); await fs.mkdir(images, { recursive: true });
  project.generated_images = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => { const file = path.join(images, `scene${number}.png`); await fs.writeFile(file, PNG); return file; }));
  await projects.save(project);

  const settingsRepository = new ProviderSettingsRepository(root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("runway", { value: "key_test_runway_1234567890" });
  const budget = new RunwayBudget(root, 10);

  const previews = new LocalVideoPreviewService(projects, projectsRoot, budget);
  const submit = new LocalVideoSubmissionService(projects, previews, undefined, providerSettings, budget);
  const preview = await previews.preview(project.project_id, undefined);
  const accepted = await submit.start(project.project_id, { confirmationId: preview.confirmationId!, userRequestId: "request_1", approved: true, prompts: preview.previews.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });

  return { root, projectsRoot, projects, providerSettings, budget, accepted, project: await projects.findById("video_workflow") };
}

function newWorkflow(deps: Awaited<ReturnType<typeof setupWithConnectedRunway>>) {
  return new LocalVideoWorkflowService(deps.projects, deps.projectsRoot, deps.providerSettings, deps.budget);
}

/** Routes fetch calls by URL: POST submit -> a fresh task id; GET task -> RUNNING on the 1st check, SUCCEEDED after; GET output URL -> fixed bytes. */
function runwayFetchMock(options: { failTaskId?: string; neverSucceedTaskId?: string } = {}) {
  const checkCounts = new Map<string, number>();
  let nextTaskId = 1;
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/image_to_video")) {
      const taskId = `task-${nextTaskId++}`;
      return { ok: true, status: 200, json: async () => ({ id: taskId }), headers: { get: () => null } } as unknown as Response;
    }
    if (url.includes("/v1/tasks/")) {
      const taskId = url.split("/v1/tasks/")[1]!;
      if (taskId === options.failTaskId) {
        return { ok: true, status: 200, json: async () => ({ id: taskId, status: "FAILED", failure: "content policy violation" }), headers: { get: () => null } } as unknown as Response;
      }
      const count = (checkCounts.get(taskId) ?? 0) + 1; checkCounts.set(taskId, count);
      if (taskId === options.neverSucceedTaskId || count === 1) {
        return { ok: true, status: 200, json: async () => ({ id: taskId, status: "RUNNING" }), headers: { get: () => null } } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ id: taskId, status: "SUCCEEDED", output: [`https://cdn.runway/${taskId}.mp4`] }), headers: { get: () => null } } as unknown as Response;
    }
    if (url.startsWith("https://cdn.runway/")) {
      const bytes = Buffer.from("fake-mp4-bytes");
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), headers: { get: () => null } } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url} ${init?.method}`);
  });
}

describe("real Runway video workflow", () => {
  it("submits, polls through running-then-succeeded, and advances scene by scene to completion", async () => {
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z");
    vi.setSystemTime(now);

    let progress = await workflow.run("video_workflow", deps.accepted.jobId);
    expect(progress).toMatchObject({ status: "running", currentSceneNumber: 1 });

    for (let scene = 1; scene <= 6; scene++) {
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await workflow.getProgress("video_workflow", deps.accepted.jobId); // 1st check: still running
      expect(progress.status).toBe("running");
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await workflow.getProgress("video_workflow", deps.accepted.jobId); // 2nd check: succeeded, advances
    }

    expect(progress).toMatchObject({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const project = await deps.projects.findById("video_workflow");
    expect(project.workflow_state).toBe(WorkflowState.ReviewingVideos);
    expect(await Promise.all([1, 2, 3, 4, 5, 6].map((scene) => fs.readFile(path.join(deps.projectsRoot, "video_workflow", "videos", "runway", `scene${scene}.mp4`), "utf8")))).toEqual(Array(6).fill("fake-mp4-bytes"));
  });

  it("halts at a scene Runway explicitly reports FAILED, without submitting later scenes, and lets the user regenerate it", async () => {
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock({ failTaskId: "task-1" });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    await workflow.run("video_workflow", deps.accepted.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    const progress = await workflow.getProgress("video_workflow", deps.accepted.jobId);
    expect(progress).toMatchObject({ status: "failed", failedSceneNumbers: [1] });
    expect(progress.sceneErrors).toEqual({ 1: "content policy violation" });
    const submitCallsAfterFailure = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video")).length;
    expect(submitCallsAfterFailure).toBe(1); // only scene 1 was ever submitted — no skipping ahead

    const regenerated = await workflow.regenerate("video_workflow", deps.accepted.jobId, [1]);
    expect(regenerated.status).toBe("running");
    const project = await deps.projects.findById("video_workflow");
    expect(project.workflow_state).toBe(WorkflowState.GeneratingVideos);
  });

  it("buys only the failed scene when a retry follows three that already succeeded", async () => {
    // Every other failure test in this file fails at scene 1, so nothing has ever asked what a retry does with
    // the scenes already paid for. At $0.25 a scene this is the most expensive way to be wrong, and it happens
    // on the button a person presses immediately after seeing the error. The image side has the same test for
    // the same reason; video is the half that costs more.
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock({ failTaskId: "task-4" }); // task ids are handed out in submission order
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    await workflow.run("video_workflow", deps.accepted.jobId);
    let progress;
    for (let scene = 1; scene <= 4; scene++) {
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await workflow.getProgress("video_workflow", deps.accepted.jobId);
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await workflow.getProgress("video_workflow", deps.accepted.jobId);
    }
    expect(progress).toMatchObject({ status: "failed", failedSceneNumbers: [4] });
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video")).length).toBe(4);

    fetchMock.mockClear();
    await workflow.regenerate("video_workflow", deps.accepted.jobId, [4]);

    // One submission, and it is scene 4's prompt — not a fresh run of everything before it.
    const submits = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video"));
    expect(submits.length).toBe(1);
    const project = await deps.projects.findById("video_workflow");
    const records = project.video_generation_records as Array<Record<string, unknown>>;
    const scene4 = records.find((record) => record.scene_number === 4)!;
    expect(JSON.parse(String((submits[0]![1] as RequestInit).body))).toMatchObject({ promptText: String(scene4.prompt) });
    // And the three already bought keep the outputs they were billed for.
    for (const scene of [1, 2, 3]) {
      expect(records.find((record) => record.scene_number === scene)!.status).toBe("succeeded");
    }
  });

  it("appends a one-off additionalInstruction to the resubmitted scene's prompt without persisting it into the record", async () => {
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock({ failTaskId: "task-1" });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    await workflow.run("video_workflow", deps.accepted.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await workflow.getProgress("video_workflow", deps.accepted.jobId); // scene 1 fails

    const recordForScene1 = (records: Array<Record<string, unknown>>) => records.find((record) => record.scene_number === 1)!;
    fetchMock.mockClear();
    const basePrompt = String(recordForScene1((await deps.projects.findById("video_workflow")).video_generation_records as Array<Record<string, unknown>>).prompt);
    await workflow.regenerate("video_workflow", deps.accepted.jobId, [1], "  더 격렬하게  ");
    const submitCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/v1/image_to_video"))!;
    expect(JSON.parse(String((submitCall[1] as RequestInit).body))).toMatchObject({ promptText: `${basePrompt}\n더 격렬하게` });

    // Not stored: the record's own prompt field stays the plain scene prompt.
    const project = await deps.projects.findById("video_workflow");
    expect(String(recordForScene1(project.video_generation_records as Array<Record<string, unknown>>).prompt)).toBe(basePrompt);
  });

  it("reports a retry cost estimate reflecting real recorded spend for a Runway job", async () => {
    const deps = await setupWithConnectedRunway();
    await deps.budget.record("other-project", 1, "video", true, 4, new Date("2026-08-23T00:00:00.000Z"));
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock({ failTaskId: "task-1" });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    await workflow.run("video_workflow", deps.accepted.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    const progress = await workflow.getProgress("video_workflow", deps.accepted.jobId);
    expect(progress.status).toBe("failed");
    // The recorded spend includes both the 4 injected above and scene 1's own real failed-attempt record (0.25) —
    // a failure still records estimated cost as actual, per RunwayBudget's own contract.
    expect(progress.retryEstimate).toEqual({
      perSceneCostUsd: 0.25,
      budget: { monthlyLimitUsd: 10, spentUsd: 4.25, remainingUsd: 5.75, estimatedRequestCostUsd: 0.25, canSpend: true },
    });
  });

  it("fails the scene with a category code plus Runway's own rejection detail instead of an uncaught exception when Runway rejects the submission itself", async () => {
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    void init;
    const url = String(input);
      if (url.endsWith("/v1/image_to_video")) {
        return { ok: false, status: 401, json: async () => ({ error: "invalid api key" }), headers: { get: () => null } } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await workflow.run("video_workflow", deps.accepted.jobId);
    const progress = await workflow.getProgress("video_workflow", deps.accepted.jobId);
    expect(progress).toMatchObject({ status: "failed", failedSceneNumbers: [1] });
    // The appended detail is only for the persisted record — sceneErrorMessage's exact-match lookup falls back
    // to a generic message for anything outside the known bare-category set, so this never reaches the screen.
    expect(progress.sceneErrors).toEqual({ 1: "authentication: invalid api key" });
  });

  it("keeps advancing on its own background timer even when nothing polls getProgress", async () => {
    // Deliberately uses REAL timers and a real (short) wait rather than vi.useFakeTimers(): the internal timer's
    // work chains several real fs.promises operations (including atomicWriteUtf8File's own setTimeout-based
    // Windows-lock retry backoff), and driving that reliably through vitest's fake-timer microtask stepping is
    // fragile. A real wait exercises the actual mechanism end-to-end with no simulation gap.
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    await workflow.run("video_workflow", deps.accepted.jobId); // submits scene 1, schedules the internal timer
    // Backdate scene 1's checkpoint so the throttle allows a real check on the very next tick, instead of
    // waiting out a full extra poll interval before the first one.
    const submitted = await deps.projects.findById("video_workflow");
    submitted.video_generation_records = (submitted.video_generation_records as Array<Record<string, unknown>>).map((record) =>
      record.scene_number === 1 ? { ...record, runway_last_checked_at: new Date(Date.now() - (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000).toISOString() } : record);
    await deps.projects.save(submitted);

    // Two real ticks are needed: the 1st check only ever reports RUNNING (matching Runway's real behavior of
    // never resolving on the very first poll), the 2nd reports SUCCEEDED and advances to scene 2.
    //
    // Waited for what the ticks do, not for how long two of them usually take. A fixed sleep of
    // interval * 2 + 3 seconds is right until the machine is busy, and then the ticks land after it and the
    // assertions read a half-finished state — which is how this test came to fail about once every few full
    // runs while passing every time it was run on its own.
    // Wait for the *last* of the two facts, not the first. Scene 2 is submitted after scene 1 is written as
    // succeeded, so a loop that stops at scene 1 can read the gap between those two writes and find scene 2
    // still "created" — which is exactly how this failed roughly one full run in five while passing every time
    // it ran alone. Scene 2 reaching "running" implies scene 1 finished, so waiting on it covers both.
    const deadline = Date.now() + (RUNWAY_POLL_INTERVAL_SECONDS * 4 + 10) * 1000;
    let project = await deps.projects.findById("video_workflow");
    for (;;) {
      const records = project.video_generation_records as Array<Record<string, unknown>>;
      const first = records.find((record) => record.scene_number === 1);
      const second = records.find((record) => record.scene_number === 2);
      if (second?.status === "running") break;
      if (Date.now() > deadline) throw new Error(`the background timer left scene 1 ${String(first?.status)} and scene 2 ${String(second?.status)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      project = await deps.projects.findById("video_workflow");
    }

    const records = project.video_generation_records as Array<Record<string, unknown>>;
    const scene1 = records.find((record) => record.scene_number === 1)!;
    const scene2 = records.find((record) => record.scene_number === 2)!;
    expect(scene1.status).toBe("succeeded");
    expect(scene2.status).toBe("running");
    workflow.onModuleDestroy();
  }, 20000);

  it("never submits the same scene twice when two advance calls race", async () => {
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([workflow.getProgress("video_workflow", deps.accepted.jobId), workflow.getProgress("video_workflow", deps.accepted.jobId)]);
    const submitCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video")).length;
    expect(submitCalls).toBe(1);
    workflow.onModuleDestroy();
  });

  it("resumes checking the same in-flight task from a fresh service instance after a simulated crash", async () => {
    const deps = await setupWithConnectedRunway();
    const first = newWorkflow(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    await first.run("video_workflow", deps.accepted.jobId); // scene 1 submitted as task-1
    first.onModuleDestroy(); // simulate the process (and its in-memory timers) disappearing

    const second = newWorkflow(deps); // fresh instance, same on-disk project
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await second.getProgress("video_workflow", deps.accepted.jobId); // still running
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    const progress = await second.getProgress("video_workflow", deps.accepted.jobId); // succeeds
    expect(progress.completedSceneNumbers).toContain(1);
    const submitCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video")).length;
    expect(submitCalls).toBe(2); // scene 1 (once, by `first`) + scene 2 (once, by `second` after scene 1 succeeded) — never re-submits scene 1
    second.onModuleDestroy();
  });

  it("surfaces a budget-exceeded preflight as a failed scene instead of an uncaught exception", async () => {
    const deps = await setupWithConnectedRunway();
    await deps.budget.record("other-project", 1, "video", true, 10, new Date("2026-08-23T00:00:00.000Z")); // exhaust the shared monthly budget
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const progress = await workflow.run("video_workflow", deps.accepted.jobId);
    expect(progress).toMatchObject({ status: "failed", failedSceneNumbers: [1] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports each scene's real recorded cost in the review response, accumulating across a regeneration", async () => {
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    let progress = await workflow.run("video_workflow", deps.accepted.jobId);
    for (let scene = 1; scene <= 6; scene++) {
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await workflow.getProgress("video_workflow", deps.accepted.jobId);
      now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
      progress = await workflow.getProgress("video_workflow", deps.accepted.jobId);
    }
    expect(progress.status).toBe("succeeded");

    const firstReview = await workflow.getReview("video_workflow", deps.accepted.jobId);
    expect(firstReview.reviews.every((review) => review.costUsd === 0.25)).toBe(true);

    // Regenerate scene 1 and let it succeed again — its recorded cost should accumulate, not replace.
    await workflow.regenerate("video_workflow", deps.accepted.jobId, [1]);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await workflow.getProgress("video_workflow", deps.accepted.jobId);
    now = new Date(now.getTime() + (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000); vi.setSystemTime(now);
    await workflow.getProgress("video_workflow", deps.accepted.jobId);

    const secondReview = await workflow.getReview("video_workflow", deps.accepted.jobId);
    expect(secondReview.reviews.find((review) => review.sceneNumber === 1)?.costUsd).toBeCloseTo(0.5, 8);
    expect(secondReview.reviews.filter((review) => review.sceneNumber !== 1).every((review) => review.costUsd === 0.25)).toBe(true);
  });

  it("never overwrites a scene another advance already claimed while a submission was in flight — warns instead of silently losing the earlier (real, billed) task", async () => {
    // Reproduces the shape of the real incident (docs/06_DECISIONS.md D-005: two POSTs per scene, one task ever
    // polled) without needing genuine OS-level concurrency — the fetch mock stalls scene 1's submission response
    // just long enough for the test to write a conflicting "already running" record in between, the same window
    // an actual race would need.
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    let resolveSubmit: (value: unknown) => void = () => {};
    let notifyReachedSubmit: () => void = () => {};
    const reachedSubmit = new Promise<void>((resolve) => { notifyReachedSubmit = resolve; });
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    void init;
    const url = String(input);
      if (url.endsWith("/v1/image_to_video")) {
        notifyReachedSubmit();
        return new Promise((resolve) => { resolveSubmit = resolve; });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const runPromise = workflow.run("video_workflow", deps.accepted.jobId);
    // Let run() reach the point where its POST is in flight (awaiting resolveSubmit) before racing it. A signal
    // from the mock itself, not a fixed setTimeout, so this stays reliable regardless of how many real fs
    // operations (claim persistence included) run before the call actually reaches fetch.
    await reachedSubmit;

    const inFlight = await deps.projects.findById("video_workflow");
    const claimed = {
      ...inFlight,
      video_generation_records: inFlight.video_generation_records.map((raw) => {
        const record = raw as Record<string, unknown>;
        return record.scene_number === 1
          ? { ...record, status: "running", runway_task_id: "task-other-winner", runway_submitted_at: "2026-08-27T00:00:00.000Z", runway_last_checked_at: "2026-08-27T00:00:00.000Z" }
          : record;
      }),
    };
    await deps.projects.save(claimed);

    resolveSubmit({ ok: true, status: 200, json: async () => ({ id: "task-mine-orphaned" }), headers: { get: () => null } });
    await runPromise;

    const project = await deps.projects.findById("video_workflow");
    const scene1 = project.video_generation_records.find((record) => (record as Record<string, unknown>).scene_number === 1) as Record<string, unknown>;
    expect(scene1.runway_task_id).toBe("task-other-winner"); // the earlier, real submission is never overwritten
    expect(project.warnings).toEqual([expect.stringContaining("1번 장면")]);
    expect(project.warnings[0]).not.toContain("task-mine-orphaned"); // no raw task id leaked into user-facing text
  });

  it("never double-submits the same scene when two independent service instances race — the shape of a nest-watch dev-server restart, not just a same-process double call", async () => {
    // docs/06_DECISIONS.md D-005: the in-memory `advancing` Set (asserted by the "two advance calls race" test
    // above) only ever serializes calls within one process. `apps/backend`'s dev script restarts the whole
    // process on every file save, and the old and new process can briefly overlap, each with its own empty Set —
    // a real user's Runway dashboard showed exactly three scenes submitted twice, one second apart. Two separate
    // `LocalVideoWorkflowService` instances against the same on-disk project reproduce that overlap without
    // needing to actually spawn two OS processes.
    const deps = await setupWithConnectedRunway();
    const first = newWorkflow(deps);
    const second = newWorkflow(deps);
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

    const firstRun = first.run("video_workflow", deps.accepted.jobId);
    // Whichever instance's call reaches fetch first stalls here, still holding the file lock — a deterministic
    // signal from the mock itself, not a fixed setTimeout, so this stays reliable under real CPU contention.
    await reachedSubmit;
    let secondSettled = false;
    const secondRun = second.run("video_workflow", deps.accepted.jobId).finally(() => { secondSettled = true; }); // a "second process" racing in
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

    expect(submitCalls).toBe(1); // `second` was blocked on the file lock until `first` finished, then saw scene 1 already claimed/running and never submitted its own
    const project = await deps.projects.findById("video_workflow");
    const scene1 = project.video_generation_records.find((record) => (record as Record<string, unknown>).scene_number === 1) as Record<string, unknown>;
    expect(scene1.status).toBe("running");
    expect(scene1.runway_task_id).toBe("task-1");
    expect(project.warnings).toEqual([]); // a clean handoff, not a detected conflict — `second` never got far enough to collide
    first.onModuleDestroy(); second.onModuleDestroy();
  });

  it("never resubmits a scene claimed by a process that then vanished before recording any outcome — surfaces it as a failed scene instead of guessing", async () => {
    // Simulates the residual crash window my two-phase claim narrows but cannot close entirely: a previous
    // process persisted "submitting" (claimSceneForSubmission) and then disappeared (killed mid-flight) before
    // ever learning whether Runway actually created a task. We cannot tell, so — unlike every other failure path
    // — this must never auto-resubmit; the user has to check their Runway dashboard first (docs/06_DECISIONS.md D-005).
    const deps = await setupWithConnectedRunway();
    const workflow = newWorkflow(deps);
    vi.useFakeTimers();
    const now = new Date("2026-08-23T10:00:00.000Z"); vi.setSystemTime(now);

    const project = await deps.projects.findById("video_workflow");
    const claimed = {
      ...project,
      video_generation_records: project.video_generation_records.map((raw) => {
        const record = raw as Record<string, unknown>;
        return record.scene_number === 1
          ? { ...record, status: "submitting", runway_claimed_at: new Date(now.getTime() - (SUBMIT_CLAIM_TIMEOUT_SECONDS + 5) * 1000).toISOString() }
          : record;
      }),
    };
    await deps.projects.save(claimed);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const progress = await workflow.getProgress("video_workflow", deps.accepted.jobId);

    expect(progress).toMatchObject({ status: "failed", failedSceneNumbers: [1] });
    expect(progress.sceneErrors).toEqual({ 1: "submit_interrupted" });
    expect(fetchMock).not.toHaveBeenCalled();
    // The ledger stays honest even though we never learned the real outcome — this is exactly the $2.00-vs-$3.00
    // under-count Round 152 found, closed by recording the estimate here rather than leaving no row at all.
    expect(await deps.budget.spentThisMonth(now)).toBeCloseTo(0.25, 8);
    workflow.onModuleDestroy();
  });
});
