import { describe, expect, it, vi } from "vitest";

import { NEWS_SUMMARY_MAX_CHARS, type NewsArticleInput } from "@ai-animation-studio/shared";

import { GEMINI_SUMMARY_FALLBACK_MODEL, GEMINI_SUMMARY_MODEL, GEMINI_SUMMARY_RETRY_DELAYS_MS, NewsSummaryProviderError, summariseArticle } from "./gemini-summary-adapter.js";

/**
 * The one paid-capable call in the news reel, tested on its own.
 *
 * 🔴 **It had no pairs at all, and the controller's pairs hide that.** They replace `callProvider` wholesale to
 * test the order of the steps around it, which is the right thing for them to do — and it means the adapter's
 * own behaviour was never looked at: not the network guard, not the response parsing, not what a 429 becomes.
 * Same shape as the hole found in Round 951: the seam had a pair and the thing on the other side of it did not.
 */

const ARTICLE: NewsArticleInput = {
  title: "물가 상승률 3.2%로 둔화",
  body: "통계청은 3.2%라고 밝혔다. ".repeat(40),
  publisher: "연합뉴스",
  publishedAt: "2026-09-19T09:00:00+09:00",
  sourceUrl: "https://www.yna.co.kr/view/1",
};

const answering = (payload: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof globalThis.fetch;

const ok = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe("the summary adapter's request", () => {
  it("returns what the provider wrote, untouched", async () => {
    const call = answering(ok("  물가는 3.2% 둔화됐다.  "));
    expect(await summariseArticle(ARTICLE, "key", { fetch: call })).toBe("물가는 3.2% 둔화됐다.");
  });

  /**
   * 🔴 **D-016 lives here.** A test process reaching a real provider with whatever key happens to sit on disk
   * cost real, untraced Runway charges once. `assertRealNetworkCallAllowed` refuses any unmocked `fetch` under
   * vitest — and nothing checked that this adapter calls it, which is the one place it has to.
   */
  it("refuses to go out at all when the fetch is not a mock", async () => {
    const real = (async () => new Response("{}")) as unknown as typeof globalThis.fetch;
    await expect(summariseArticle(ARTICLE, "key", { fetch: real })).rejects.toThrow(/Refusing a real Gemini network call/);
  });

  /**
   * 🟠 The prompt is not what makes this safe — `checkNewsSummary` is — but it is what shifts the odds, and
   * two things in it are load-bearing enough to pin: the article's own text has to be there (a summariser with
   * no article invents everything), and the length the card can hold has to be stated, since
   * `NEWS_SUMMARY_MAX_CHARS` is otherwise a constant nothing consults.
   */
  it("sends the article's own text and the card's length limit", async () => {
    const call = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const sent = String(init?.body);
      expect(sent).toContain(ARTICLE.body.slice(0, 40));
      expect(sent).toContain(ARTICLE.title);
      expect(sent).toContain(String(NEWS_SUMMARY_MAX_CHARS));
      return new Response(JSON.stringify(ok("요약")), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await summariseArticle(ARTICLE, "key", { fetch: call });
  });

  it("carries the key in the header and names the model in the address", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const call = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify(ok("요약")), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await summariseArticle(ARTICLE, "secret-key", { fetch: call });
    expect(seen[0]!.url).toContain(GEMINI_SUMMARY_MODEL);
    expect((seen[0]!.init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
    // 🔴 And never in the address, where it would land in any log that records a URL.
    expect(seen[0]!.url).not.toContain("secret-key");
  });

  /** A person is waiting on this with a screen open, so a provider that never answers has to stop. */
  it("gives up on a provider that accepts the connection and never answers", async () => {
    const call = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as unknown as typeof globalThis.fetch;

    await expect(summariseArticle(ARTICLE, "key", { fetch: call, timeoutMs: 30 })).rejects.toThrow();
  });
});

describe("the summary adapter's answer", () => {
  /**
   * 🔴 **Every step of the response is checked rather than assumed, and this is why.** Whatever comes back here
   * goes straight to `checkNewsSummary` and then to a card. A shape we did not expect, read optimistically,
   * becomes `undefined` somewhere in a summary — or worse, an empty string that checks clean because there is
   * nothing in it to find.
   */
  it("refuses a response with no candidates, no parts, or no text", async () => {
    for (const payload of [
      {},
      { candidates: [] },
      { candidates: [{}] },
      { candidates: [{ content: {} }] },
      { candidates: [{ content: { parts: "not an array" } }] },
      { candidates: [{ content: { parts: [{}] } }] },
      { candidates: [{ content: { parts: [{ text: "" }] } }] },
      { candidates: [{ content: { parts: [{ text: "   " }] } }] },
      null,
    ]) {
      await expect(summariseArticle(ARTICLE, "key", { fetch: answering(payload) }), JSON.stringify(payload))
        .rejects.toBeInstanceOf(NewsSummaryProviderError);
    }
  });

  it("joins the parts when the provider splits its answer", async () => {
    const split = { candidates: [{ content: { parts: [{ text: "물가는 " }, { text: "3.2% 둔화됐다." }] } }] };
    expect(await summariseArticle(ARTICLE, "key", { fetch: answering(split) })).toBe("물가는 3.2% 둔화됐다.");
  });

  /**
   * 🟠 429 travels because it is the one status the person can act on: it is the free tier's own refusal,
   * arriving after ours would have. Everything else is ours to look at rather than theirs.
   */
  it("keeps the status on a refusal, so the free tier's own limit is tellable from our bugs", async () => {
    const tooMany = await summariseArticle(ARTICLE, "key", { fetch: answering({}, 429) }).catch((error: unknown) => error);
    expect(tooMany).toBeInstanceOf(NewsSummaryProviderError);
    expect((tooMany as NewsSummaryProviderError).status).toBe(429);

    const ours = await summariseArticle(ARTICLE, "key", { fetch: answering({}, 500), retryDelayMs: 0 }).catch((error: unknown) => error);
    expect((ours as NewsSummaryProviderError).status).toBe(500);
  });

  /** A body that is not JSON at all is the same failure as one with the wrong shape, and must not be a summary. */
  it("refuses a body that is not JSON", async () => {
    const call = vi.fn(async () => new Response("<html>gateway error</html>", { status: 200 })) as unknown as typeof globalThis.fetch;
    await expect(summariseArticle(ARTICLE, "key", { fetch: call })).rejects.toBeInstanceOf(NewsSummaryProviderError);
  });

  /**
   * 🔴 An unreachable provider is a `NewsSummaryProviderError` like any other, not a raw network error. The
   * caller books the call against the day either way — it went out — and it can only do that if this throws
   * something it recognises rather than whatever `fetch` chose to throw.
   */
  it("turns an unreachable provider into its own refusal", async () => {
    const call = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof globalThis.fetch;
    await expect(summariseArticle(ARTICLE, "key", { fetch: call })).rejects.toBeInstanceOf(NewsSummaryProviderError);
  });
});

/**
 * 캡틴D's first working day: 요약 pressed, 「요약을 받지 못했다」, pressed again, same. Probed from outside —
 * the model answers 503 「experiencing high demand」 in bursts and 200 a minute later. One attempt turns a
 * busy minute into a dead end at random.
 */
describe("a provider that is merely busy", () => {
  const busyThenFine = () => {
    let calls = 0;
    return vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 503 })
        : new Response(JSON.stringify(ok("물가는 3.2% 둔화됐다.")), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
  };

  it("tries once more when the provider says it is busy", async () => {
    const call = busyThenFine();
    expect(await summariseArticle(ARTICLE, "key", { fetch: call, retryDelayMs: 0 })).toBe("물가는 3.2% 둔화됐다.");
    expect((call as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });

  /**
   * 🔴 429 is the free tier's own refusal and retrying it is what a rate limit exists to stop. 4xx is a
   * request that will fail identically next time. Only 5xx is worth a second attempt.
   */
  it("does not try again on a refusal that will not change", async () => {
    for (const status of [400, 401, 429]) {
      const call = vi.fn(async () => new Response("", { status })) as unknown as typeof globalThis.fetch;
      await expect(summariseArticle(ARTICLE, "key", { fetch: call, retryDelayMs: 0 })).rejects.toBeInstanceOf(NewsSummaryProviderError);
      expect((call as unknown as { mock: { calls: unknown[] } }).mock.calls, `${status}`).toHaveLength(1);
    }
  });

  /** 🟠 Bounded, not a loop — a provider that stays busy is given up on, and the person is told rather than waited on. */
  it("gives up after the retries on both models, keeping the status", async () => {
    const call = vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof globalThis.fetch;
    const error = await summariseArticle(ARTICLE, "key", { fetch: call, retryDelayMs: 0 }).catch((caught: unknown) => caught);
    expect((error as NewsSummaryProviderError).status).toBe(503);
    const perModel = 1 + GEMINI_SUMMARY_RETRY_DELAYS_MS.length;
    expect((call as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(perModel * 2);
  });

  /**
   * 🔴 2026-09-22: timeout, timeout, then 503 on both attempts — twenty minutes with no reel and nothing wrong on
   * our side. The fallback is the one other name an actual call has confirmed.
   */
  it("asks the fallback model when the pinned one stays busy, and returns its answer", async () => {
    const urls: string[] = [];
    const call = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return String(url).includes(`/${GEMINI_SUMMARY_MODEL}:`)
        ? new Response("", { status: 503 })
        : new Response(JSON.stringify(ok("물가는 3.2% 둔화됐다.")), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    expect(await summariseArticle(ARTICLE, "key", { fetch: call, retryDelayMs: 0 })).toBe("물가는 3.2% 둔화됐다.");
    expect(urls.at(-1)).toContain(`/${GEMINI_SUMMARY_FALLBACK_MODEL}:`);
    expect(urls.filter((url) => url.includes(`/${GEMINI_SUMMARY_MODEL}:`))).toHaveLength(1 + GEMINI_SUMMARY_RETRY_DELAYS_MS.length);
  });

  /** A retired name is the other thing a second model fixes — it has happened twice. */
  it("asks the fallback model when the pinned one is gone", async () => {
    const urls: string[] = [];
    const call = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return String(url).includes(`/${GEMINI_SUMMARY_MODEL}:`)
        ? new Response(JSON.stringify({ error: { message: "no longer available" } }), { status: 404 })
        : new Response(JSON.stringify(ok("요약")), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    expect(await summariseArticle(ARTICLE, "key", { fetch: call, retryDelayMs: 0 })).toBe("요약");
    expect(urls).toHaveLength(2);
  });

  /** 🔴 The free tier's own refusal is not a busy model — another model under the same key is the same refusal. */
  it("does not take a rate limit to the fallback model", async () => {
    const call = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof globalThis.fetch;
    await expect(summariseArticle(ARTICLE, "key", { fetch: call, retryDelayMs: 0 })).rejects.toBeInstanceOf(NewsSummaryProviderError);
    expect((call as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});

/**
 * 🔴 **Why a call failed has to survive the call.** 2026-09-21, twice: 「요약을 받지 못했다」, and the ledger said
 * `succeeded: false` and nothing more. A busy model, a retired model name and a dead connection all read the
 * same, and the only way left to tell them apart was to spend another call. The adapter names the reason; the
 * route books it.
 */
describe("what a failure is called", () => {
  const failureOf = (promise: Promise<unknown>) => promise.then(() => "resolved", (error: unknown) => (error as NewsSummaryProviderError).failure);

  it("keeps the provider's own sentence with the status — that is where a retired model says so", async () => {
    const call = answering({ error: { message: "This model models/gemini-3.6-flash is no longer available   to new users." } }, 404);
    // Both models answered 404 here, so the one named is the last one asked.
    expect(await failureOf(summariseArticle(ARTICLE, "key", { fetch: call }))).toBe(
      `${GEMINI_SUMMARY_FALLBACK_MODEL} http 404: This model models/gemini-3.6-flash is no longer available to new users.`,
    );
  });

  it("keeps the last status when a busy provider stays busy", async () => {
    const call = answering({ error: { message: "This model is currently experiencing high demand." } }, 503);
    expect(await failureOf(summariseArticle(ARTICLE, "key", { fetch: call, retryDelayMs: 0 }))).toBe(
      `${GEMINI_SUMMARY_FALLBACK_MODEL} http 503: This model is currently experiencing high demand.`,
    );
  });

  it("says only the status when the refusal carried no sentence", async () => {
    const call = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof globalThis.fetch;
    expect(await failureOf(summariseArticle(ARTICLE, "key", { fetch: call }))).toBe(`${GEMINI_SUMMARY_MODEL} http 429`);
  });

  it("cuts a long sentence short rather than filling the ledger with it", async () => {
    const call = answering({ error: { message: "가".repeat(1_000) } }, 400);
    expect((await failureOf(summariseArticle(ARTICLE, "key", { fetch: call }))).length).toBeLessThanOrEqual(`${GEMINI_SUMMARY_MODEL} http 400: `.length + 200);
  });

  it("tells a provider that never answered from one that could not be reached", async () => {
    const hangs = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as unknown as typeof globalThis.fetch;
    expect(await failureOf(summariseArticle(ARTICLE, "key", { fetch: hangs, timeoutMs: 30 }))).toBe(`${GEMINI_SUMMARY_MODEL} timeout`);

    const refused = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof globalThis.fetch;
    expect(await failureOf(summariseArticle(ARTICLE, "key", { fetch: refused }))).toBe(`${GEMINI_SUMMARY_MODEL} unreachable`);
  });

  it("calls an answer with nothing in it empty", async () => {
    expect(await failureOf(summariseArticle(ARTICLE, "key", { fetch: answering({ candidates: [] }) }))).toBe("empty");
  });
});
