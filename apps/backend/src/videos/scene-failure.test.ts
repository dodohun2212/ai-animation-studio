import { describe, expect, it } from "vitest";
import { SCENE_FAILURE_REMEDIES } from "@ai-animation-studio/shared";
import { needsChangedInput, sceneFailureFor } from "./scene-failure.js";
import { runwayFailureOutcome } from "./runway-video-adapter.js";

describe("what a screen is told about a failed scene", () => {
  /**
   * The $0.25 that bought nothing, twice.
   *
   * Captain D's Episode 5 scene 3 failed with INTERNAL.BAD_OUTPUT.CODE01, the screen said "잠시 후 다시 시도해
   * 주세요", he pressed it, and it failed identically and was charged again. The provider's own documentation
   * lists that code's first causes as text or logos on the input media and prompts that ask for text — waiting
   * changes nothing.
   */
  it("says a bad-output failure needs a different input, not another press", () => {
    const failure = sceneFailureFor("An unexpected error occurred. (Runway code: INTERNAL.BAD_OUTPUT.CODE01)", "INTERNAL.BAD_OUTPUT.CODE01");
    expect(failure.remedy, "pressing again is what cost the money").toBe("change_input");
    expect(failure.billedOnFailure, "and it is charged for every time").toBe(true);
    expect(failure.providerCode, "the code alone, so a screen can reason about it").toBe("INTERNAL.BAD_OUTPUT.CODE01");
  });

  /**
   * The documented `retryable` flag is not the same question.
   *
   * BAD_OUTPUT is listed as retryable and fails forever until the input changes; that is why `remedy` has three
   * values instead of a boolean. Collapsing them is exactly the advice that was already given once.
   */
  it("keeps 'may be transient' and 'send the same thing again' apart", () => {
    expect(runwayFailureOutcome("THIRD_PARTY.UNAVAILABLE").remedy, "genuinely worth another press").toBe("retry");
    expect(runwayFailureOutcome("INTERNAL.BAD_OUTPUT.CODE01").remedy, "documented as retryable, and never succeeds unchanged").toBe("change_input");
  });

  /** Safety refusals differ from each other in the one way that costs money. */
  it("reports input safety as unbilled and output safety as billed, because that is the difference", () => {
    expect(runwayFailureOutcome("SAFETY.INPUT.PROMPT")).toEqual({ remedy: "not_retryable", billedOnFailure: false });
    expect(runwayFailureOutcome("SAFETY.OUTPUT.VIDEO")).toEqual({ remedy: "not_retryable", billedOnFailure: true });
  });

  /**
   * A code nobody has taught this app about must not read as safe to press.
   *
   * The honest default is that we do not know another press will work, and we do know this provider charges for
   * failures — so "retry" comes with "billed", never with a quiet false.
   */
  it("treats an unknown provider code as billed", () => {
    const unknown = runwayFailureOutcome("SOMETHING.NEW");
    expect(unknown.billedOnFailure).toBe(true);
    expect(SCENE_FAILURE_REMEDIES).toContain(unknown.remedy);
  });

  /**
   * "We have no code" is not "it was free" — Cowork's catch, and the ledger proves it.
   *
   * Episode 5 scene 3 failed twice and left two $0.25 rows; its records predate the stored failure code, so the
   * old rule would have told Captain D those were free while his own ledger said otherwise. A wrong "you were
   * charged" costs a moment's doubt. A wrong "you were not charged" is money.
   *
   * Only the refusals this app makes before sending anything are reported as free, because those are the ones
   * it can know about. A timeout means the task was submitted and this provider charges for failures.
   */
  it("reports a failure it cannot price as billed, and only a never-sent refusal as free", () => {
    expect(sceneFailureFor("timeout")).toEqual({ category: "timeout", remedy: "retry", billedOnFailure: true });
    expect(sceneFailureFor("no_output").billedOnFailure, "the task was submitted").toBe(true);
    expect(sceneFailureFor("submit_interrupted").billedOnFailure, "and this one may have been").toBe(true);

    expect(sceneFailureFor("budget_exceeded")).toEqual({ category: "budget_exceeded", remedy: "retry", billedOnFailure: false });
    expect(sceneFailureFor("budget_ledger_unreadable").billedOnFailure, "refused before anything was sent").toBe(false);

    expect(sceneFailureFor("timeout").providerCode, "we were not told a code, so we do not invent one").toBeUndefined();
  });
});

/**
 * Whether a re-buy has to change something first.
 *
 * The screens learned this and the server did not: both hold their confirm until an instruction is written,
 * while `regenerate` accepted a byte-identical resend. That is the purchase that happened on 2026-09-05 — the
 * screen said "try again shortly", the button was pressed, and $0.25 bought the same failure twice.
 */
describe("whether re-buying a scene needs the input to change", () => {
  it("asks for a change on the codes documented as caused by the input", () => {
    expect(needsChangedInput("INTERNAL.BAD_OUTPUT.CODE01")).toBe(true);
    expect(needsChangedInput("ASSET.INVALID")).toBe(true);
  });

  it("asks for nothing on a safety refusal, whose fix is a different first frame", () => {
    // Regenerating the image and coming back is a legitimate route that no instruction accompanies. Refusing it
    // here would block the fix rather than the mistake.
    expect(needsChangedInput("SAFETY.INPUT.CODE01")).toBe(false);
    expect(needsChangedInput("SAFETY.OUTPUT")).toBe(false);
  });

  it("asks for nothing when there is no code, or none we know", () => {
    // We do not know the input is the cause, and inventing a requirement is its own way of being wrong.
    expect(needsChangedInput(undefined)).toBe(false);
    expect(needsChangedInput("SOMETHING.NEW")).toBe(false);
  });
});
