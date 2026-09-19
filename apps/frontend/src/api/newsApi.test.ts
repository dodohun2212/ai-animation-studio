import { afterEach, describe, expect, it, vi } from "vitest";

import { NewsApiError, fetchNewsArticle, getNewsReelSetup } from "./newsApi.js";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const publishers = [{ host: "yna.co.kr", name: "연합뉴스", body: "address" as const }];

afterEach(() => { vi.restoreAllMocks(); });

describe("news setup", () => {
  it("reads the publishers and today's count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ publishers, dailyCalls: { used: 2, limit: 10 } })));
    const setup = await getNewsReelSetup();
    expect(setup.publishers).toEqual(publishers);
    expect(setup.dailyCalls).toEqual({ used: 2, limit: 10 });
  });

  /**
   * 🔴 An unreadable ledger must not take the publisher list down with it. The two facts are independent, and a
   * screen that cannot say which papers work because a count file is corrupt turns one broken thing into two.
   */
  it("still gets the publishers when the count is unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ publishers, dailyCalls: null })));
    const setup = await getNewsReelSetup();
    expect(setup.publishers).toEqual(publishers);
    expect(setup.dailyCalls).toBeNull();
  });

  /**
   * 🔴 `null` said and nothing said are different facts, and only one is an answer. A response with the key
   * missing is refused here rather than handed on as `undefined` — `undefined` is what a screen is most likely
   * to draw as "no problem", which would turn the ledger's most conservative answer into its most permissive.
   */
  it("refuses a response that leaves the count out entirely", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ publishers })));
    await expect(getNewsReelSetup()).rejects.toBeInstanceOf(NewsApiError);
  });
});

describe("news article fetch", () => {
  /**
   * 🔴 **The pair Cowork asked for (Round 931 §3), and the one that keeps the list from becoming a gate.**
   * The publisher list travels so the screen can *say* it. The moment anything here filters on it — however
   * kindly meant — the app holds a second copy of a safety check, and that copy is wrong about exactly the
   * addresses the real one exists for: it judges the typed host, while the host that matters is wherever the
   * redirects end. So a domain that is plainly not on the list must still reach the server.
   */
  it("sends an address that is not on the publisher list, and lets the server refuse it", async () => {
    const call = vi.fn(async (_url: string, _init?: RequestInit) => ok({ outcome: "refused", reason: "publisher_not_allowed", publishers }));
    vi.stubGlobal("fetch", call);

    const result = await fetchNewsArticle("https://www.nytimes.com/2026/09/19/world.html");

    expect(call).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(call.mock.calls[0]?.[1]?.body))).toEqual({ url: "https://www.nytimes.com/2026/09/19/world.html" });
    expect(result).toEqual({ outcome: "refused", reason: "publisher_not_allowed", publishers });
  });

  /** And the same for an address pointing inside the network — the screen never decides that either. */
  it("sends an address pointing inside the network rather than judging it here", async () => {
    const call = vi.fn(async (_url: string, _init?: RequestInit) => ok({ outcome: "refused", reason: "private_address", publishers }));
    vi.stubGlobal("fetch", call);
    await fetchNewsArticle("https://192.168.0.1/a");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("returns the article when the body was found", async () => {
    const article = { title: "제목", body: "본문", publisher: "연합뉴스", publishedAt: "2026-09-19T09:00:00+09:00", sourceUrl: "https://www.yna.co.kr/view/1" };
    vi.stubGlobal("fetch", vi.fn(async () => ok({ outcome: "article", article })));
    expect(await fetchNewsArticle("https://www.yna.co.kr/view/1")).toEqual({ outcome: "article", article });
  });

  /**
   * 🟠 Not an exception, on purpose. The server knocked, got the page, and could not tell which part was the
   * article — it did its job and one step is left for the person. Throwing would flatten that into the same red
   * box as a refusal, and send the screen to "try something else" when the answer is "paste the body here".
   */
  it("hands back the body-not-found branch with what was read, rather than throwing", async () => {
    const body = { outcome: "body_not_found", sourceUrl: "https://www.yna.co.kr/view/1", publisher: "연합뉴스", title: "제목", publishedAt: "2026-09-19T09:00:00+09:00" };
    vi.stubGlobal("fetch", vi.fn(async () => ok(body)));
    expect(await fetchNewsArticle("https://www.yna.co.kr/view/1")).toEqual(body);
  });

  it("accepts a body-not-found branch from a page that says neither headline nor date", async () => {
    const body = { outcome: "body_not_found", sourceUrl: "https://www.yna.co.kr/view/1", publisher: "연합뉴스", title: "", publishedAt: null };
    vi.stubGlobal("fetch", vi.fn(async () => ok(body)));
    expect((await fetchNewsArticle("https://www.yna.co.kr/view/1")).outcome).toBe("body_not_found");
  });

  /** An outcome nobody wrote a branch for must not fall through to whichever branch happens to be last. */
  it("refuses an unknown outcome and an unknown refusal reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ outcome: "probably_fine" })));
    await expect(fetchNewsArticle("https://www.yna.co.kr/view/1")).rejects.toBeInstanceOf(NewsApiError);

    vi.stubGlobal("fetch", vi.fn(async () => ok({ outcome: "refused", reason: "just_because", publishers })));
    await expect(fetchNewsArticle("https://www.yna.co.kr/view/1")).rejects.toBeInstanceOf(NewsApiError);
  });
});
