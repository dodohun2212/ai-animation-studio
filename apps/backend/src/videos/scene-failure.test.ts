import { describe, expect, it } from "vitest";
import { SCENE_FAILURE_REMEDIES } from "@ai-animation-studio/shared";
import { sceneFailureFor } from "./scene-failure.js";
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
   * A verdict this app reached by itself has no provider code, and no charge of its own.
   *
   * A timeout or an empty output is our reading of the situation; whatever money moved was recorded by the call
   * that moved it, at the moment it moved. Claiming a second charge here would double-count it on screen.
   */
  it("distinguishes a failure we decided from one the provider reported", () => {
    expect(sceneFailureFor("timeout")).toEqual({ category: "timeout", remedy: "retry", billedOnFailure: false });
    expect(sceneFailureFor("timeout").providerCode, "we were not told a code, so we do not invent one").toBeUndefined();
  });
});
