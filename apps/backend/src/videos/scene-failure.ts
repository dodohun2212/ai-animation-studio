import type { SceneFailure } from "@ai-animation-studio/shared";
import { runwayFailureOutcome } from "./runway-video-adapter.js";

/**
 * One failed scene, described so a screen can act rather than guess.
 *
 * Both video pipelines already stored a sentence per failed scene, and the client looked that whole sentence up
 * in a table of codes. When the sentence was the provider's — "An unexpected error occurred. (Runway code:
 * INTERNAL.BAD_OUTPUT.CODE01)" — the lookup missed and the screen said "잠시 후 다시 시도해 주세요". On
 * 2026-09-05 that was the wrong advice, and it was taken, and it was charged for a second time.
 *
 * `category` keeps the old string exactly, so nothing that reads it changes. What is new is the provider's code
 * on its own, what to do about it, and whether it was billed anyway.
 *
 * A failure this app decided on its own — a timeout, an empty output, a budget refusal — has no provider code,
 * and is reported as `retry` and not billed. Both are true of every one of them: they are our own verdicts, and
 * the ones that cost money record their own ledger row at the moment they spend.
 */
export function sceneFailureFor(category: string, failureCode?: string): SceneFailure {
  if (!failureCode) return { category, remedy: "retry", billedOnFailure: false };
  return { category, providerCode: failureCode, ...runwayFailureOutcome(failureCode) };
}
