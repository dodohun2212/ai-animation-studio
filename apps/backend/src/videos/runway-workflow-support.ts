import type { SceneNumber } from "@ai-animation-studio/shared";
import { createRunwayImageToVideoTask, downloadRunwayOutput, getRunwayTask } from "./runway-video-adapter.js";

/** Matches Python's runway_poll_interval_seconds default. Real Runway status is never re-checked more often than this, no matter how often a caller (e.g. a Frontend poll every 400ms) invokes advanceRunwayScene. */
export const RUNWAY_POLL_INTERVAL_SECONDS = 5;
/** Matches Python's runway_task_timeout_seconds default. A scene stuck non-terminal past this is marked failed so the user can retry instead of waiting forever. */
export const RUNWAY_TASK_TIMEOUT_SECONDS = 900;

export interface RunwaySceneState {
  sceneNumber: SceneNumber;
  status: "created" | "running" | "succeeded" | "failed";
  taskId?: string;
  submittedAt?: string;
  lastCheckedAt?: string;
}

export interface RunwaySceneInput {
  imageBytes: Buffer;
  imageMimeType: string;
  prompt: string;
  model?: string;
  ratio?: string;
  durationSeconds?: number;
}

export interface RunwayAdvanceBudget {
  preflight(estimatedCostUsd: number): Promise<void>;
  record(projectId: string, apiType: string, succeeded: boolean, estimatedCostUsd: number): Promise<void>;
}

export interface RunwayAdapterCallOptions {
  fetchImpl?: typeof fetch;
  sleep?: (seconds: number) => Promise<void>;
  maxRetries?: number;
}

export interface RunwayAdvanceDeps {
  apiSecret: string;
  projectId: string;
  apiType: string;
  estimatedCostPerSceneUsd: number;
  budget: RunwayAdvanceBudget;
  now?: () => Date;
  pollIntervalSeconds?: number;
  taskTimeoutSeconds?: number;
  adapterOptions?: RunwayAdapterCallOptions;
}

export type RunwayAdvanceResult =
  | { kind: "unchanged" }
  | { kind: "submitted"; sceneNumber: SceneNumber; taskId: string; submittedAt: string }
  | { kind: "still-running"; sceneNumber: SceneNumber }
  /** Our own status-check attempt failed (network/server, after the adapter's own retries) — NOT the same as Runway
   *  reporting the task itself failed. State must stay untouched so the next check tries again. */
  | { kind: "check-error"; sceneNumber: SceneNumber }
  | { kind: "succeeded"; sceneNumber: SceneNumber; bytes: Buffer }
  /** Runway explicitly reported FAILED/CANCELLED, the task exceeded RUNWAY_TASK_TIMEOUT_SECONDS, or the succeeded
   *  response had no usable output — the only cases that should ever stop the pipeline at this scene. */
  | { kind: "failed"; sceneNumber: SceneNumber; error: string };

/**
 * Advances one Runway scene by exactly one step: either checks the currently-running scene's task once (throttled
 * to at most one real Runway call per pollIntervalSeconds), or submits the next not-yet-started scene. Never
 * blocks waiting for a task to finish — a caller (an HTTP request or a background timer tick alike) gets back a
 * single outcome immediately and decides what to persist. Pure: no filesystem, no Nest, no workflow-state opinion
 * beyond "which scene is running vs. created" as reflected in `states`.
 */
export async function advanceRunwayScene(
  states: readonly RunwaySceneState[],
  inputForScene: (sceneNumber: SceneNumber) => Promise<RunwaySceneInput>,
  deps: RunwayAdvanceDeps,
): Promise<RunwayAdvanceResult> {
  const now = deps.now ?? (() => new Date());
  const pollIntervalSeconds = deps.pollIntervalSeconds ?? RUNWAY_POLL_INTERVAL_SECONDS;
  const taskTimeoutSeconds = deps.taskTimeoutSeconds ?? RUNWAY_TASK_TIMEOUT_SECONDS;

  // Scenes are continuity-dependent (each prompt continues from the previous one's ending), so a failed scene
  // halts the pipeline entirely rather than skipping ahead. The caller surfaces this and the user must explicitly
  // regenerate the failed scene before anything advances again.
  if (states.some((state) => state.status === "failed")) return { kind: "unchanged" };

  const running = states.find((state) => state.status === "running");
  if (running) {
    if (!running.taskId) {
      // Defensive: "running" with no taskId is an invalid/corrupted record. Fail it rather than looping forever.
      return { kind: "failed", sceneNumber: running.sceneNumber, error: "invalid_state" };
    }
    const nowDate = now();
    if (running.submittedAt) {
      const elapsedSeconds = (nowDate.getTime() - new Date(running.submittedAt).getTime()) / 1000;
      if (elapsedSeconds > taskTimeoutSeconds) {
        await deps.budget.record(deps.projectId, deps.apiType, false, deps.estimatedCostPerSceneUsd).catch(() => undefined);
        return { kind: "failed", sceneNumber: running.sceneNumber, error: "timeout" };
      }
    }
    if (running.lastCheckedAt) {
      const sinceLastCheckSeconds = (nowDate.getTime() - new Date(running.lastCheckedAt).getTime()) / 1000;
      if (sinceLastCheckSeconds < pollIntervalSeconds) return { kind: "unchanged" };
    }

    let task;
    try {
      task = await getRunwayTask(deps.apiSecret, running.taskId, deps.adapterOptions);
    } catch {
      return { kind: "check-error", sceneNumber: running.sceneNumber };
    }

    if (task.status === "SUCCEEDED") {
      const url = task.outputUrls[0];
      if (!url) {
        await deps.budget.record(deps.projectId, deps.apiType, false, deps.estimatedCostPerSceneUsd);
        return { kind: "failed", sceneNumber: running.sceneNumber, error: "no_output" };
      }
      let bytes: Buffer;
      try {
        bytes = await downloadRunwayOutput(url, deps.adapterOptions);
      } catch {
        // The task itself succeeded on Runway's side; only our download attempt failed. Try again next check.
        return { kind: "check-error", sceneNumber: running.sceneNumber };
      }
      await deps.budget.record(deps.projectId, deps.apiType, true, deps.estimatedCostPerSceneUsd);
      return { kind: "succeeded", sceneNumber: running.sceneNumber, bytes };
    }
    if (task.status === "FAILED" || task.status === "CANCELLED") {
      await deps.budget.record(deps.projectId, deps.apiType, false, deps.estimatedCostPerSceneUsd);
      return { kind: "failed", sceneNumber: running.sceneNumber, error: task.failure || task.status };
    }
    return { kind: "still-running", sceneNumber: running.sceneNumber };
  }

  const next = states.find((state) => state.status === "created");
  if (!next) return { kind: "unchanged" };

  await deps.budget.preflight(deps.estimatedCostPerSceneUsd);
  const input = await inputForScene(next.sceneNumber);
  const { taskId } = await createRunwayImageToVideoTask(
    deps.apiSecret,
    input.imageBytes,
    input.imageMimeType,
    input.prompt,
    { model: input.model, ratio: input.ratio, durationSeconds: input.durationSeconds, ...deps.adapterOptions },
  );
  return { kind: "submitted", sceneNumber: next.sceneNumber, taskId, submittedAt: now().toISOString() };
}
