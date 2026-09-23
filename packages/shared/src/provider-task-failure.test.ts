import { describe, expect, it } from "vitest";

import { PROVIDER_TASK_FAILURES, providerTaskFailure } from "./api.js";

/**
 * The sentence and the remedy come from one row, so they cannot tell a person two different things.
 *
 * They were about to be two lists keyed on the same codes — the adapter picking a remedy, the screen picking a
 * sentence — and the failure that would have produced is not hypothetical. It is on screen today: a Runway task
 * failure misses the screen's category table and falls back to "잠시 후 다시 시도해 주세요", directly above
 * advice that says sending the same thing again will fail. That fallback was followed twice and charged twice
 * on 2026-09-05.
 */
describe("what the provider's failure codes mean", () => {
  it("recognises a code by its documented prefix, suffix and all", () => {
    // The code that cost money arrives as INTERNAL.BAD_OUTPUT.CODE01; matching the bare prefix would have
    // recognised nothing, which is exactly how the whole sentence came to be looked up as if it were a code.
    expect(providerTaskFailure("INTERNAL.BAD_OUTPUT.CODE01")?.remedy).toBe("change_input");
    expect(providerTaskFailure("internal.bad_output")?.remedy).toBe("change_input");
  });

  it("answers nothing for a code it has never heard of, rather than guessing", () => {
    // The caller's default is retry-and-billed: we do not know it is safe to press again, and we do know this
    // provider charges for failures. A guess here would replace that honest default with an invented one.
    expect(providerTaskFailure("SOMETHING.NEW")).toBeUndefined();
    expect(providerTaskFailure(undefined)).toBeUndefined();
  });

  it("never tells someone to wait when waiting is not the answer", () => {
    // The rule the incident broke, stated once: a row whose remedy is "the input is the cause" must not carry
    // a sentence that reads as "this may pass on its own".
    const waiting = /잠시 후|기다/;
    for (const entry of PROVIDER_TASK_FAILURES) {
      if (entry.remedy === "retry") continue;
      expect(entry.message, `${entry.prefix} tells someone to wait for a failure that waiting cannot fix`).not.toMatch(waiting);
    }
  });

  it("leaves the money sentence to billedOnFailure alone", () => {
    // Two sentences about one person's money are two sentences that can disagree, and the screen composes the
    // billing one from the field. A row that also states it in prose is a second source for the same fact.
    for (const entry of PROVIDER_TASK_FAILURES) {
      expect(entry.message, `${entry.prefix} states billing in prose as well as in billedOnFailure`).not.toMatch(/청구/);
    }
  });
});

/**
 * 🔴 The code that was live on this machine and matched nothing.
 *
 * `INPUT_PREPROCESSING.SAFETY.TEXT` starts with `INPUT_PREPROCESSING`, not `SAFETY.INPUT`, so prefix matching
 * missed it, the caller's default answered `retry`, and the screen told somebody to wait and press again —
 * three times, against a moderation verdict that waiting cannot change (저승길 scene 6, 2026-09-23).
 */
describe("the refusal that reads the text, not the first frame", () => {
  it("knows the code Runway actually sends, and calls it a change-the-input failure", () => {
    const failure = providerTaskFailure("INPUT_PREPROCESSING.SAFETY.TEXT");
    expect(failure?.remedy).toBe("change_input");
    // Measured, not assumed: three refusals, every one billed_credits 0 and actual_cost_usd 0.
    expect(failure?.billedOnFailure).toBe(false);
    // It must send somebody to the words, not to the picture — the two SAFETY.* rows above mean the first frame.
    expect(failure?.message).toContain("글");
  });

  /** 🟠 Guessed siblings are sentences stated with confidence about something nobody checked. */
  it("leaves the INPUT_PREPROCESSING variants nobody has seen unknown", () => {
    expect(providerTaskFailure("INPUT_PREPROCESSING.SOMETHING_ELSE")).toBeUndefined();
  });
});
