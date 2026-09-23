import { describe, expect, it } from "vitest";

import { OPENAI_ERROR_CATEGORIES } from "@ai-animation-studio/shared";

import {
  OPENAI_KOREAN_MESSAGES,
  OPENAI_MAX_BACKOFF_SECONDS,
  OPENAI_RETRYABLE_CATEGORIES,
  backoffSeconds,
  PROVIDER_MESSAGE_MAX_CHARS,
  classifyOpenAiHttpError,
  describeOpenAiHttpError,
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

/**
 * 🔴 The half this file used to read and throw away.
 *
 * `category` is a bucket of ours — nine of them cover every refusal OpenAI can send — so `safety_policy` is one
 * sentence for "the prompt was refused", "the reference picture was refused" and "both". Which one it was is in
 * the provider's own sentence and nowhere else: not in the spend ledger (one `succeeded: false` row), not in
 * the project file, and not on the screen once it has been reloaded.
 */
describe("what the provider itself said", () => {
  const refusalWithId = (status: number, body: unknown, requestId?: string) =>
    new Response(JSON.stringify(body), { status, headers: requestId ? { "x-request-id": requestId } : {} });

  it("carries the sentence as the provider wrote it, not the folded copy classification used", async () => {
    const spoken = "Your request was rejected as a result of our safety system. Image input may not depict a real person.";
    const failure = await describeOpenAiHttpError(refusalWithId(400, { error: { message: spoken } }, "req_abc123"));

    expect(failure.category).toBe("safety_policy");
    // 🔴 Verbatim. The classifier lowercases to match on; a person reading "your request was rejected…" learns
    // the same fact while being told, in the app's own voice, that we retyped their sentence.
    expect(failure.providerMessage).toBe(spoken);
    expect(failure.providerRequestId).toBe("req_abc123");
  });

  /**
   * 🔴 This string is written into a project's own file and rendered on a screen. OpenAI has no reason to echo a
   * key back, which is exactly why nobody would be watching the day one did (AGENTS.md: never log, return or
   * commit a secret).
   */
  it("redacts a secret that arrives inside the provider's own sentence", async () => {
    const failure = await describeOpenAiHttpError(refusalWithId(401, { error: { message: "Incorrect API key provided: sk-proj-abcdef1234567890." } }));
    expect(failure.providerMessage).toContain("[REDACTED]");
    expect(failure.providerMessage).not.toContain("sk-proj-abcdef1234567890");
  });

  /** 🟠 A guard, not an editor — and a sentence that was cut must not read as one that ended. */
  it("caps a body long enough to be something other than a sentence, visibly", async () => {
    const failure = await describeOpenAiHttpError(refusalWithId(400, { error: { message: "x".repeat(PROVIDER_MESSAGE_MAX_CHARS + 50) } }));
    expect(failure.providerMessage).toHaveLength(PROVIDER_MESSAGE_MAX_CHARS + 1);
    expect(failure.providerMessage?.endsWith("…")).toBe(true);
  });

  /**
   * Absent, not empty. A screen tests for the field to decide whether there is a quotation to show, and `""`
   * renders as an empty pair of quote marks — which reads as the provider having said nothing on purpose.
   */
  it("leaves both fields off when the refusal carried neither", async () => {
    const failure = await describeOpenAiHttpError(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    expect(failure).toEqual({ category: "server" });
  });

  /** The narrow view stays exactly what it was — every caller that only wanted the bucket still gets it. */
  it("sorts a refusal into the same category the classifier always did", async () => {
    expect(await describeOpenAiHttpError(refusalWithId(429, { error: { code: "insufficient_quota" } })))
      .toMatchObject({ category: await classifyOpenAiHttpError(refusal(429, { error: { code: "insufficient_quota" } })) });
  });
});
