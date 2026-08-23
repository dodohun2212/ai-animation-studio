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
import { RUNWAY_POLL_INTERVAL_SECONDS } from "./runway-workflow-support.js";
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

  const previews = new LocalVideoPreviewService(projects, projectsRoot);
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
    const submitCallsAfterFailure = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/image_to_video")).length;
    expect(submitCallsAfterFailure).toBe(1); // only scene 1 was ever submitted — no skipping ahead

    const regenerated = await workflow.regenerate("video_workflow", deps.accepted.jobId, [1]);
    expect(regenerated.status).toBe("running");
    const project = await deps.projects.findById("video_workflow");
    expect(project.workflow_state).toBe(WorkflowState.GeneratingVideos);
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
    await new Promise((resolve) => setTimeout(resolve, (RUNWAY_POLL_INTERVAL_SECONDS * 2 + 3) * 1000));

    const project = await deps.projects.findById("video_workflow");
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
    await deps.budget.record("other-project", "video", true, 10, new Date("2026-08-23T00:00:00.000Z")); // exhaust the shared monthly budget
    const workflow = newWorkflow(deps);
    const fetchMock = runwayFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const progress = await workflow.run("video_workflow", deps.accepted.jobId);
    expect(progress).toMatchObject({ status: "failed", failedSceneNumbers: [1] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
