import { describe, expect, it, vi } from "vitest";
import type { SceneNumber } from "@ai-animation-studio/shared";
import { advanceRunwayScene, RUNWAY_POLL_INTERVAL_SECONDS, RUNWAY_TASK_TIMEOUT_SECONDS, SUBMIT_CLAIM_TIMEOUT_SECONDS, type RunwaySceneState } from "./runway-workflow-support.js";

const IMAGE_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const noSleep = async () => {};

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}
function binaryResponse(bytes: Buffer): Response {
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), headers: { get: () => null } } as unknown as Response;
}

function sixScenes(overrides: Partial<Record<SceneNumber, Partial<RunwaySceneState>>> = {}): RunwaySceneState[] {
  return ([1, 2, 3, 4, 5, 6] as const).map((sceneNumber) => ({ sceneNumber, status: "created" as const, ...overrides[sceneNumber] }));
}

function fakeBudget() {
  return { preflight: vi.fn().mockResolvedValue(undefined), record: vi.fn().mockResolvedValue(undefined) };
}

async function input() {
  return { imageBytes: IMAGE_BYTES, imageMimeType: "image/png", prompt: "a hero walks forward" };
}

describe("advanceRunwayScene", () => {
  it("submits the first created scene when nothing is running", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1" }));
    const budget = fakeBudget();
    const result = await advanceRunwayScene(sixScenes(), input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result).toMatchObject({ kind: "submitted", sceneNumber: 1, taskId: "task-1" });
    expect(budget.preflight).toHaveBeenCalledWith(0.25);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails the scene with the adapter's error category and Runway's own rejection detail instead of throwing when submission itself is rejected", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "invalid api key" }));
    const budget = fakeBudget();
    const result = await advanceRunwayScene(sixScenes(), input, {
      apiSecret: "bad-secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, adapterOptions: { fetchImpl, sleep: noSleep, maxRetries: 0 },
    });
    // The detail is appended for diagnosability — never shown to the user (see toVideoWorkflowDisplayError /
    // sceneErrorMessage's exact-match-only lookup, which falls back to a generic message for anything outside
    // the known bare-category set, this string included).
    expect(result).toEqual({ kind: "failed", sceneNumber: 1, error: "authentication: invalid api key" });
    // No Runway task was ever created — a rejected submission bills nothing, so actualCostUsd is 0 even though
    // the estimate stays 0.25 (the failure is still visible in the ledger, just not counted toward the month).
    const [, , , , estimatedCostUsd, , actualCostUsd] = (budget.record as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(estimatedCostUsd).toBe(0.25);
    expect(actualCostUsd).toBe(0);
  });

  it("records only the bare category when Runway's rejected response has no readable detail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    const budget = fakeBudget();
    const result = await advanceRunwayScene(sixScenes(), input, {
      apiSecret: "bad-secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, adapterOptions: { fetchImpl, sleep: noSleep, maxRetries: 0 },
    });
    expect(result).toEqual({ kind: "failed", sceneNumber: 1, error: "authentication" });
  });

  it("reclassifies a credit-shortage rejection to quota_or_permission even though Runway answers with a plain 400", async () => {
    // The real incident this covers: Runway rejected scene 1 with a bare 400,
    // classified as invalid_request and told the user to check their prompt — the actual cause, confirmed only
    // once `detail` started being recorded, was an empty Runway credit balance.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: "You do not have enough credits to run this task." }));
    const budget = fakeBudget();
    const result = await advanceRunwayScene(sixScenes(), input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, adapterOptions: { fetchImpl, sleep: noSleep, maxRetries: 0 },
    });
    expect(result).toEqual({ kind: "failed", sceneNumber: 1, error: "quota_or_permission: You do not have enough credits to run this task." });
  });

  it("does not call Runway at all when the running scene was checked within the poll interval", async () => {
    const now = new Date("2026-08-23T10:00:00.000Z");
    const fetchImpl = vi.fn();
    const states = sixScenes({ 1: { status: "running", taskId: "task-1", submittedAt: now.toISOString(), lastCheckedAt: new Date(now.getTime() - 2000).toISOString() } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget: fakeBudget(), now: () => now, adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result).toEqual({ kind: "unchanged" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports still-running for a non-terminal Runway status past the poll interval", async () => {
    const now = new Date("2026-08-23T10:00:00.000Z");
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1", status: "RUNNING" }));
    const states = sixScenes({ 1: { status: "running", taskId: "task-1", submittedAt: now.toISOString(), lastCheckedAt: new Date(now.getTime() - (RUNWAY_POLL_INTERVAL_SECONDS + 1) * 1000).toISOString() } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget: fakeBudget(), now: () => now, adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result).toEqual({ kind: "still-running", sceneNumber: 1 });
  });

  it("downloads output and records success when Runway reports SUCCEEDED", async () => {
    const outputBytes = Buffer.from("fake-mp4-bytes");
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => (
      String(input).includes("/v1/tasks/") ? jsonResponse(200, { id: "task-1", status: "SUCCEEDED", output: ["https://cdn.runway/output.mp4"] }) : binaryResponse(outputBytes)
    ));
    const budget = fakeBudget();
    const states = sixScenes({ 1: { status: "running", taskId: "task-1", submittedAt: new Date().toISOString() } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result.kind).toBe("succeeded");
    if (result.kind === "succeeded") expect(result.bytes.toString()).toBe("fake-mp4-bytes");
    expect(budget.record).toHaveBeenCalledWith("p1", 1, "video", true, 0.25);
  });

  it("records failure and stops when Runway explicitly reports FAILED", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1", status: "FAILED", failure: "content policy violation" }));
    const budget = fakeBudget();
    const states = sixScenes({ 1: { status: "running", taskId: "task-1", submittedAt: new Date().toISOString() } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result).toMatchObject({ kind: "failed", sceneNumber: 1, error: "content policy violation" });
    expect(budget.record).toHaveBeenCalledWith("p1", 1, "video", false, 0.25);
  });

  it("treats a transient status-check failure as check-error, not a real failure, and never touches budget", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network down"));
    const budget = fakeBudget();
    const states = sixScenes({ 1: { status: "running", taskId: "task-1", submittedAt: new Date().toISOString() } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, adapterOptions: { fetchImpl, sleep: noSleep, maxRetries: 0 },
    });
    expect(result).toEqual({ kind: "check-error", sceneNumber: 1 });
    expect(budget.record).not.toHaveBeenCalled();
  });

  it("fails a scene that has run past the task timeout without making another Runway call", async () => {
    const now = new Date("2026-08-23T10:00:00.000Z");
    const submittedAt = new Date(now.getTime() - (RUNWAY_TASK_TIMEOUT_SECONDS + 1) * 1000).toISOString();
    const fetchImpl = vi.fn();
    const budget = fakeBudget();
    const states = sixScenes({ 1: { status: "running", taskId: "task-1", submittedAt } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, now: () => now, adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result).toEqual({ kind: "failed", sceneNumber: 1, error: "timeout" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(budget.record).toHaveBeenCalledWith("p1", 1, "video", false, 0.25);
  });

  it("propagates a budget-exceeded preflight rejection without submitting anything to Runway", async () => {
    const fetchImpl = vi.fn();
    const budget = { preflight: vi.fn().mockRejectedValue(new Error("over budget")), record: vi.fn() };
    await expect(advanceRunwayScene(sixScenes(), input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, adapterOptions: { fetchImpl, sleep: noSleep },
    })).rejects.toThrow("over budget");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("halts and reports unchanged once any scene has failed, never submitting a later scene", async () => {
    const fetchImpl = vi.fn();
    const states = sixScenes({ 2: { status: "failed" } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget: fakeBudget(), adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result).toEqual({ kind: "unchanged" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("persists a claim via beforeSubmit before the paid Runway call, and in submission order", async () => {
    // docs/06_DECISIONS.md D-005: a crash between "Runway said yes" and "we saved that" left no trace on disk,
    // so a later process (or the same one after a restart) still saw "created" and submitted the same scene
    // again. beforeSubmit is the caller's chance to persist a trace first — this only works if it genuinely runs
    // before the network call, not after.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1" }));
    const calls: string[] = [];
    const beforeSubmit = vi.fn(async (scene: SceneNumber) => { calls.push(`claim:${scene}`); });
    fetchImpl.mockImplementation(async () => { calls.push("fetch"); return jsonResponse(200, { id: "task-1" }); });
    const result = await advanceRunwayScene(sixScenes(), input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget: fakeBudget(), adapterOptions: { fetchImpl, sleep: noSleep }, beforeSubmit,
    });
    expect(result).toMatchObject({ kind: "submitted", sceneNumber: 1 });
    expect(beforeSubmit).toHaveBeenCalledWith(1, expect.any(String));
    expect(calls).toEqual(["claim:1", "fetch"]);
  });

  it("does not touch Runway or the budget for a scene still within its submit-claim window", async () => {
    const now = new Date("2026-08-23T10:00:00.000Z");
    const fetchImpl = vi.fn();
    const budget = fakeBudget();
    const states = sixScenes({ 1: { status: "submitting", claimedAt: new Date(now.getTime() - (SUBMIT_CLAIM_TIMEOUT_SECONDS - 5) * 1000).toISOString() } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, now: () => now, adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result).toEqual({ kind: "unchanged" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(budget.record).not.toHaveBeenCalled();
  });

  it("fails (without resubmitting) a claim abandoned past the submit-claim timeout, and keeps it visible in the budget ledger", async () => {
    // Unlike a rejected submission (actualCostUsd 0 — Runway never ran anything), here we genuinely don't know
    // whether Runway created a task before whoever claimed this scene vanished, so the estimate is recorded as
    // spent: better to overstate a near-miss than silently under-count a real charge (Round 152's own ledger gap
    // was exactly this — $2.00 recorded against $3.00 actually billed).
    const now = new Date("2026-08-23T10:00:00.000Z");
    const fetchImpl = vi.fn();
    const budget = fakeBudget();
    const states = sixScenes({ 1: { status: "submitting", claimedAt: new Date(now.getTime() - (SUBMIT_CLAIM_TIMEOUT_SECONDS + 5) * 1000).toISOString() } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget, now: () => now, adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result).toEqual({ kind: "failed", sceneNumber: 1, error: "submit_interrupted" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(budget.record).toHaveBeenCalledWith("p1", 1, "video", false, 0.25);
  });

  it("reports unchanged once all six scenes have succeeded", async () => {
    const fetchImpl = vi.fn();
    const states = sixScenes({ 1: { status: "succeeded" }, 2: { status: "succeeded" }, 3: { status: "succeeded" }, 4: { status: "succeeded" }, 5: { status: "succeeded" }, 6: { status: "succeeded" } });
    const result = await advanceRunwayScene(states, input, {
      apiSecret: "secret", projectId: "p1", apiType: "video", estimatedCostPerSceneUsd: 0.25,
      budget: fakeBudget(), adapterOptions: { fetchImpl, sleep: noSleep },
    });
    expect(result).toEqual({ kind: "unchanged" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
