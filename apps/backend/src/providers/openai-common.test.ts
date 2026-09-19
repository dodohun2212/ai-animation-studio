import { describe, expect, it } from "vitest";

import { OPENAI_ERROR_CATEGORIES } from "@ai-animation-studio/shared";

import {
  OPENAI_KOREAN_MESSAGES,
  OPENAI_MAX_BACKOFF_SECONDS,
  OPENAI_RETRYABLE_CATEGORIES,
  backoffSeconds,
  classifyOpenAiHttpError,
  parseRetryAfterSeconds,
} from "./openai-common.js";

/**
 * The shared machinery behind every paid OpenAI call, which had no pairs of its own.
 *
 * 🔴 Six services import this file, and what it decides is **whether a failed paid call is tried again**. Every
 * adapter has pairs for its own request; none of them looks at the table those pairs all lean on. Same shape as
 * the summary adapter's gap, one layer down and shared by far more callers.
 */

const refusal = (status: number, body?: unknown, headers?: Record<string, string>) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers });

describe("which failures are worth paying for twice", () => {
  /**
   * 🔴 **The most expensive fact in this file.** A retryable category is one where the same request might
   * succeed next time. Everything else is a guaranteed second failure — and for a key with no money left, a
   * second attempt against a provider that already said no.
   */
  it("retries only the three that can change their answer", () => {
    expect([...OPENAI_RETRYABLE_CATEGORIES].sort()).toEqual(["network", "rate_limit", "server"]);
    for (const category of ["authentication", "quota_or_permission", "invalid_request", "safety_policy", "context_length_exceeded"] as const) {
      expect(OPENAI_RETRYABLE_CATEGORIES.has(category), category).toBe(false);
    }
  });

  /**
   * 🔴 **The order of the checks is load-bearing, and this is the one that costs money.** OpenAI answers 429
   * both for "too fast" and, in some accounts, for "out of credit". `insufficient_quota` is therefore tested
   * **before** the status, because 429 alone maps to `rate_limit` — which is retryable. Read the other way
   * round, a key with no money left would be retried, backed off, and retried again against a provider that
   * has already refused for a reason waiting cannot fix.
   */
  it("calls an exhausted quota a quota problem even when it arrives as 429", async () => {
    const asQuota = await classifyOpenAiHttpError(refusal(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } }));
    expect(asQuota).toBe("quota_or_permission");
    expect(OPENAI_RETRYABLE_CATEGORIES.has(asQuota)).toBe(false);

    // And a genuine rate limit still is one, so the ordering does not swallow the case it sits in front of.
    const asRate = await classifyOpenAiHttpError(refusal(429, { error: { code: "rate_limit_exceeded" } }));
    expect(asRate).toBe("rate_limit");
    expect(OPENAI_RETRYABLE_CATEGORIES.has(asRate)).toBe(true);
  });

  /** The same trap without a code: the message alone has to be enough. */
  it("reads an exhausted quota out of the message when there is no code", async () => {
    expect(await classifyOpenAiHttpError(refusal(429, { error: { message: "You have insufficient_quota for this request" } })))
      .toBe("quota_or_permission");
  });

  /**
   * 🟠 Three categories arrive as 400 and only one of them is "your request was malformed". The order matters
   * for what a person is told to do, not for money: `safety_policy` means the content was refused and
   * `context_length_exceeded` means shorten the settings, while `invalid_request` reads as our own bug.
   */
  it("separates the three kinds of 400 rather than calling them all a bad request", async () => {
    expect(await classifyOpenAiHttpError(refusal(400, { error: { code: "content_policy_violation" } }))).toBe("safety_policy");
    expect(await classifyOpenAiHttpError(refusal(400, { error: { message: "This request was rejected by our safety system" } }))).toBe("safety_policy");
    expect(await classifyOpenAiHttpError(refusal(400, { error: { code: "context_length_exceeded" } }))).toBe("context_length_exceeded");
    expect(await classifyOpenAiHttpError(refusal(400, { error: { message: "maximum context length is 8192 tokens" } }))).toBe("context_length_exceeded");
    expect(await classifyOpenAiHttpError(refusal(400, { error: { code: "something_else" } }))).toBe("invalid_request");
  });

  it("maps the statuses that mean what they say", async () => {
    expect(await classifyOpenAiHttpError(refusal(401))).toBe("authentication");
    expect(await classifyOpenAiHttpError(refusal(402))).toBe("quota_or_permission");
    expect(await classifyOpenAiHttpError(refusal(403))).toBe("quota_or_permission");
    expect(await classifyOpenAiHttpError(refusal(500))).toBe("server");
    expect(await classifyOpenAiHttpError(refusal(503))).toBe("server");
    expect(await classifyOpenAiHttpError(refusal(418))).toBe("unknown");
  });

  /**
   * 🔴 An error body that is not JSON must still classify by status. A 500 whose body is an HTML gateway page
   * is the commonest real shape of a server error, and throwing there would turn a retryable failure into an
   * unhandled one.
   */
  it("classifies by status when the error body cannot be read", async () => {
    const html = new Response("<html>502 Bad Gateway</html>", { status: 502 });
    expect(await classifyOpenAiHttpError(html)).toBe("server");
  });
});

describe("how long to wait before paying again", () => {
  /**
   * 🔴 `NaN`, not null, is the danger. `setTimeout(NaN)` fires immediately, so a `Retry-After` of "soon" would
   * turn a polite backoff into an instant re-request — against the rate limit that produced it.
   */
  it("refuses a Retry-After that is not a number, rather than passing NaN on", () => {
    expect(parseRetryAfterSeconds(refusal(429, undefined, { "retry-after": "12" }))).toBe(12);
    expect(parseRetryAfterSeconds(refusal(429, undefined, { "retry-after": "soon" }))).toBeNull();
    expect(parseRetryAfterSeconds(refusal(429))).toBeNull();
  });

  it("grows the wait and then stops growing", () => {
    expect(backoffSeconds(0)).toBe(0.5);
    expect(backoffSeconds(1)).toBe(1);
    expect(backoffSeconds(2)).toBe(2);
    expect(backoffSeconds(3)).toBe(4);
    // 🟠 Capped, because this runs while somebody watches a screen. A doubling with no ceiling reaches a
    // minute by the seventh attempt, and nobody waits a minute to be told it failed.
    expect(backoffSeconds(10)).toBe(OPENAI_MAX_BACKOFF_SECONDS);
  });
});

describe("what a person reads", () => {
  /**
   * 🟠 The `Record` makes a missing key a compile error; an empty or duplicated sentence is not. Two categories
   * sharing a sentence means the screen says the same thing about "your key is wrong" and "you are out of
   * credit", which are different afternoons.
   */
  it("gives every category its own non-empty sentence", () => {
    const sentences = OPENAI_ERROR_CATEGORIES.map((category) => OPENAI_KOREAN_MESSAGES[category]);
    for (const [index, sentence] of sentences.entries()) {
      expect(sentence, OPENAI_ERROR_CATEGORIES[index]).toBeTruthy();
    }
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  /** 🔴 The one that must not sound transient: waiting does not refill an account. */
  it("does not tell somebody out of credit to try again in a moment", () => {
    expect(OPENAI_KOREAN_MESSAGES.quota_or_permission).not.toContain("잠시 후");
    expect(OPENAI_KOREAN_MESSAGES.rate_limit).toContain("잠시 후");
  });
});
