import type { SceneNumber } from "@ai-animation-studio/shared";
import { createRunwayImageToVideoTask, downloadRunwayOutput, getRunwayTask, RunwayAdapterError } from "./runway-video-adapter.js";

/** Matches Python's runway_poll_interval_seconds default. Real Runway status is never re-checked more often than this, no matter how often a caller (e.g. a Frontend poll every 400ms) invokes advanceRunwayScene. */
export const RUNWAY_POLL_INTERVAL_SECONDS = 5;
/** Matches Python's runway_task_timeout_seconds default. A scene stuck non-terminal past this is marked failed so the user can retry instead of waiting forever. */
export const RUNWAY_TASK_TIMEOUT_SECONDS = 900;
/**
 * How long a "submitting" claim (persisted just before the Runway POST, so a crash between the claim and the
 * final "running"+taskId record leaves a trace instead of silently reverting to "created") is trusted before it's
 * treated as abandoned. A real POST resolves in low single-digit seconds; this stays far short of
 * RUNWAY_TASK_TIMEOUT_SECONDS because nothing is actually running yet at this point, only being requested.
 * Matches project-lock.ts's own stale-lock threshold, since both describe "how long can a legitimate submit take."
 */
export const SUBMIT_CLAIM_TIMEOUT_SECONDS = 60;

export interface RunwaySceneState {
  sceneNumber: SceneNumber;
  status: "created" | "submitting" | "running" | "succeeded" | "failed";
  taskId?: string;
  submittedAt?: string;
  lastCheckedAt?: string;
  /** Set only for status "submitting": when the pre-POST claim was made, to detect an abandoned claim (see SUBMIT_CLAIM_TIMEOUT_SECONDS). */
  claimedAt?: string;
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
  /** `actualCostUsd` (after `now`) defaults to `estimatedCostUsd` — see RunwayBudget.record's doc comment for when it must be passed as 0. */
  record(projectId: string, sceneNumber: SceneNumber, apiType: string, succeeded: boolean, estimatedCostUsd: number, now?: Date, actualCostUsd?: number): Promise<void>;
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
  submitClaimTimeoutSeconds?: number;
  adapterOptions?: RunwayAdapterCallOptions;
  /**
   * Called with the chosen scene right before the paid, non-idempotent create call — the caller's chance to
   * persist a "submitting" claim first, so a crash between this call and the eventual "submitted"/"failed" result
   * leaves a trace on disk instead of the scene silently looking untouched ("created") to whoever reads it next.
   */
  beforeSubmit?: (sceneNumber: SceneNumber, claimedAt: string) => Promise<void>;
}

export type RunwayAdvanceResult =
  | { kind: "unchanged" }
  | { kind: "submitted"; sceneNumber: SceneNumber; taskId: string; submittedAt: string }
  | { kind: "still-running"; sceneNumber: SceneNumber }
  /** Our own status-check attempt failed (network/server, after the adapter's own retries) — NOT the same as Runway
   *  reporting the task itself failed. State must stay untouched so the next check tries again. */
  | { kind: "check-error"; sceneNumber: SceneNumber }
  | { kind: "succeeded"; sceneNumber: SceneNumber; bytes: Buffer; spendUnrecorded?: true }
  /** Runway explicitly reported FAILED/CANCELLED, the task exceeded RUNWAY_TASK_TIMEOUT_SECONDS, or the succeeded
   *  response had no usable output — the only cases that should ever stop the pipeline at this scene. */
  | { kind: "failed"; sceneNumber: SceneNumber; error: string; spendUnrecorded?: true };

/**
 * This scene was paid for and the ledger does not know it — the outcome above still stands.
 *
 * Every `record` call below runs *after* Runway has been paid: a task finished, failed, or ran past the timeout.
 * The spend is a fact whether or not we manage to write it down, so a throw here would destroy the very thing the
 * money bought. Measured: with the ledger unreadable while a scene was running, the succeeded branch threw, the
 * downloaded video was dropped, and the background timer re-polled, re-downloaded and re-dropped it on every tick
 * — forever, with the screen still saying the job was running.
 *
 * The two `.catch(() => undefined)`s this replaces made the opposite mistake: they kept the outcome and lost the
 * fact silently, so the month's total quietly ran short with nobody told.
 *
 * Nothing new is bought on the strength of this. `preflight` reads the same ledger and still refuses
 * (RunwayBudget.load — docs/06_DECISIONS.md D-036); this only decides what happens to work already done.
 *
 * A cost of 0 is not a spend and never raises the flag: a submission Runway rejected outright cost nothing to
 * under-count, and a warning there would be noise stacked on the failure the person is already looking at.
 */
async function spendUnrecorded(deps: RunwayAdvanceDeps, sceneNumber: SceneNumber, succeeded: boolean, actualCostUsd?: number): Promise<boolean> {
  try {
    // The trailing pair is passed only when a cost is actually being overridden. Handing `record` an explicit
    // `undefined` would change the call's shape for every existing caller and quietly let its own default for
    // `now` go unexercised.
    await (actualCostUsd === undefined
      ? deps.budget.record(deps.projectId, sceneNumber, deps.apiType, succeeded, deps.estimatedCostPerSceneUsd)
      : deps.budget.record(deps.projectId, sceneNumber, deps.apiType, succeeded, deps.estimatedCostPerSceneUsd, new Date(), actualCostUsd));
    return false;
  } catch {
    return actualCostUsd !== 0;
  }
}

/** Spreads into a result literal, so a scene that cost money the ledger missed carries that out to the caller. */
const unrecorded = (flag: boolean) => (flag ? { spendUnrecorded: true } as const : {});

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
  const submitClaimTimeoutSeconds = deps.submitClaimTimeoutSeconds ?? SUBMIT_CLAIM_TIMEOUT_SECONDS;
  const nowDate = now();

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
    if (running.submittedAt) {
      const elapsedSeconds = (nowDate.getTime() - new Date(running.submittedAt).getTime()) / 1000;
      if (elapsedSeconds > taskTimeoutSeconds) {
        const missed = await spendUnrecorded(deps, running.sceneNumber, false);
        return { kind: "failed", sceneNumber: running.sceneNumber, error: "timeout", ...unrecorded(missed) };
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
        const missed = await spendUnrecorded(deps, running.sceneNumber, false);
        return { kind: "failed", sceneNumber: running.sceneNumber, error: "no_output", ...unrecorded(missed) };
      }
      let bytes: Buffer;
      try {
        bytes = await downloadRunwayOutput(url, deps.adapterOptions);
      } catch {
        // The task itself succeeded on Runway's side; only our download attempt failed. Try again next check.
        return { kind: "check-error", sceneNumber: running.sceneNumber };
      }
      const missed = await spendUnrecorded(deps, running.sceneNumber, true);
      return { kind: "succeeded", sceneNumber: running.sceneNumber, bytes, ...unrecorded(missed) };
    }
    if (task.status === "FAILED" || task.status === "CANCELLED") {
      const missed = await spendUnrecorded(deps, running.sceneNumber, false);
      return { kind: "failed", sceneNumber: running.sceneNumber, error: task.failure || task.status, ...unrecorded(missed) };
    }
    return { kind: "still-running", sceneNumber: running.sceneNumber };
  }

  const submitting = states.find((state) => state.status === "submitting");
  if (submitting) {
    const claimedAt = submitting.claimedAt ? new Date(submitting.claimedAt).getTime() : NaN;
    const elapsedSeconds = Number.isFinite(claimedAt) ? (nowDate.getTime() - claimedAt) / 1000 : Infinity;
    if (elapsedSeconds <= submitClaimTimeoutSeconds) return { kind: "unchanged" };
    // The claim is older than a real submit call could plausibly still be running: whoever made it is gone
    // (crashed, or the process that made it was killed by a `nest watch` restart) without ever recording an
    // outcome. We cannot tell whether Runway actually created a task for this claim, so — unlike every other
    // failure path here — do NOT resubmit automatically; surface it and let the user check their Runway dashboard
    // first. actualCostUsd is left at the estimate (not 0): a task may really have been created and billed, and
    // the ledger under-counting real spend is exactly the gap this closes (docs/06_DECISIONS.md D-005).
    const missed = await spendUnrecorded(deps, submitting.sceneNumber, false);
    return { kind: "failed", sceneNumber: submitting.sceneNumber, error: "submit_interrupted", ...unrecorded(missed) };
  }

  const next = states.find((state) => state.status === "created");
  if (!next) return { kind: "unchanged" };

  await deps.budget.preflight(deps.estimatedCostPerSceneUsd);
  const claimedAt = now().toISOString();
  if (deps.beforeSubmit) await deps.beforeSubmit(next.sceneNumber, claimedAt);
  const input = await inputForScene(next.sceneNumber);
  let taskId: string;
  try {
    ({ taskId } = await createRunwayImageToVideoTask(
      deps.apiSecret,
      input.imageBytes,
      input.imageMimeType,
      input.prompt,
      { model: input.model, ratio: input.ratio, durationSeconds: input.durationSeconds, ...deps.adapterOptions },
    ));
  } catch (error) {
    // A submission-time failure (bad key, rejected prompt/image, Runway outage, ...) must become a failed scene
    // like every other failure path here — otherwise it would propagate uncaught out of advanceRunwayScene and
    // the scene would silently stay "created" forever with nothing for the user to act on. No task was ever
    // created, so nothing was ever billed — actualCostUsd 0 keeps the failure visible without eating the budget.
    // Carried out like every other path even though a cost of 0 can never raise it, so the "0 is not a spend"
    // rule is a live decision here rather than a claim in a comment. Dropping this value on the floor left that
    // rule unmeasured: an injection that made every failed write count as an unrecorded spend stayed green.
    const missed = await spendUnrecorded(deps, next.sceneNumber, false, 0);
    const code = error instanceof RunwayAdapterError ? error.category : "unknown";
    // `detail`, when Runway's rejected response carried one, is never shown to the user — it only makes the
    // persisted record diagnosable without reproducing the paid call (see RunwayAdapterError's doc comment).
    const detail = error instanceof RunwayAdapterError ? error.detail : undefined;
    return { kind: "failed", sceneNumber: next.sceneNumber, error: detail ? `${code}: ${detail}` : code, ...unrecorded(missed) };
  }
  return { kind: "submitted", sceneNumber: next.sceneNumber, taskId, submittedAt: now().toISOString() };
}
