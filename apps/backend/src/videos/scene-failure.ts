import { providerTaskFailure, type SceneFailure } from "@ai-animation-studio/shared";
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
 * 🔴 Without a provider code this used to answer `billedOnFailure: false`, and Cowork was right that "we have
 * no code" and "it was free" are not the same fact. Episode 5 scene 3 failed twice and left two $0.25 rows in
 * the ledger; its records predate this field, so under the old rule a screen would have told Captain D those
 * were free while his own ledger said otherwise. A wrong "you were charged" costs a moment's doubt; a wrong
 * "you were not charged" is money.
 *
 * So only the refusals this app makes *before* sending anything are reported as free, because those are the
 * ones it can actually know about. Everything else — a timeout, an empty output, an interrupted submit, or a
 * provider sentence from before the code was stored — is reported as billed: the task had been submitted, and
 * this provider charges for failures.
 */
const NEVER_SENT = new Set(["budget_exceeded", "budget_ledger_unreadable"]);

export function sceneFailureFor(category: string, failureCode?: string): SceneFailure {
  if (failureCode) return { category, providerCode: failureCode, ...runwayFailureOutcome(failureCode) };
  return { category, remedy: "retry", billedOnFailure: !NEVER_SENT.has(category) };
}

/**
 * Whether re-buying this scene needs something about the input to change first.
 *
 * The screens learned this and the server did not. `INTERNAL.BAD_OUTPUT` and `ASSET.INVALID` are documented as
 * caused by the input, so a byte-identical resend is a purchase of the same failure — which is exactly what
 * happened on 2026-09-05: the screen said "try again shortly", the button was pressed, and $0.25 bought nothing
 * a second time.
 *
 * Both video screens now hold the confirm until an instruction is written. This is the same rule where the
 * money actually leaves, for a caller that never went through a screen.
 *
 * Deliberately only `change_input`. `not_retryable` is the safety refusals, whose cause is the first frame —
 * regenerating the image and coming back is a legitimate route that no instruction accompanies, and refusing it
 * here would block the fix rather than the mistake. An unknown code asks for nothing: we do not know that the
 * input is the cause, and inventing a requirement is its own way of being wrong.
 */
export function needsChangedInput(failureCode: string | undefined): boolean {
  return providerTaskFailure(failureCode)?.remedy === "change_input";
}
