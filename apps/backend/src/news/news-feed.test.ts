import { describe, expect, it, vi } from "vitest";

import type { NewsPublisher } from "@ai-animation-studio/shared";

import { NEWS_FEEDS, NEWS_FEED_ITEMS_PER_PUBLISHER, fetchAllFeeds, fetchFeed } from "./news-feed.js";

/**
 * The article picker's source.
 *
 * 🔴 This file fetches from four publishers' servers, so every pair here hands it a mock. The one pair that
 * does not is the one checking that an unmocked fetch is refused outright (D-016).
 */

const yna: NewsPublisher = { host: "yna.co.kr", name: "연합뉴스", body: "address" };
const hani: NewsPublisher = { host: "hani.co.kr", name: "한겨레", body: "address" };

const rss = (items: string) => `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
const item = (title: string, link: string, date = "Sat, 20 Sep 2026 09:00:00 +0900") =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;

const answering = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof globalThis.fetch;

describe("reading one publisher's feed", () => {
  it("returns the title, the address and the time", async () => {
    const call = answering(rss(item("물가 3.2%로 둔화", "https://www.yna.co.kr/view/AKR1")));
    const [only] = await fetchFeed(NEWS_FEEDS[0]!, yna, { fetch: call });

    expect(only).toMatchObject({ title: "물가 3.2%로 둔화", publisher: "연합뉴스", host: "yna.co.kr" });
    expect(only!.url).toBe("https://www.yna.co.kr/view/AKR1");
    expect(only!.publishedAt).toBe("2026-09-20T00:00:00.000Z");
  });

  /**
   * 🔴 **D-016.** A test process that reaches four real news servers is a test process that can reach
   * anything; the guard refuses any fetch that is not a mock, and this is the pair that says this file calls it.
   */
  it("refuses to go out at all when the fetch is not a mock", async () => {
    const real = (async () => new Response("")) as unknown as typeof globalThis.fetch;
    await expect(fetchFeed(NEWS_FEEDS[0]!, yna, { fetch: real })).rejects.toThrow(/Refusing a real/);
  });

  /**
   * 🔴 **The feed's address goes through the same door as a typed one.** A feed that advertised another host —
   * a syndication partner, a link shortener, a tracker — must not put a row on screen that the next step will
   * then refuse. The row is dropped here; the publisher's own articles beside it stand.
   */
  it("drops a row pointing somewhere else and keeps the rest", async () => {
    const call = answering(rss(
      item("남의 집", "https://news.example.com/1")
      + item("빌린 주소", "http://localhost:3000/admin")
      + item("진짜 기사", "https://www.yna.co.kr/view/AKR2"),
    ));

    const items = await fetchFeed(NEWS_FEEDS[0]!, yna, { fetch: call });
    expect(items.map((row) => row.url)).toEqual(["https://www.yna.co.kr/view/AKR2"]);
  });

  /** CDATA and entities are what feed titles are actually made of; `물가 &amp; 금리` on screen reads as our bug. */
  it("unwraps CDATA and decodes entities in a title", async () => {
    const call = answering(rss(item("<![CDATA[물가 &amp; 금리 &#39;둔화&#39;]]>", "https://www.hani.co.kr/arti/1")));
    const [only] = await fetchFeed(NEWS_FEEDS[3]!, hani, { fetch: call });
    expect(only!.title).toBe("물가 & 금리 '둔화'");
  });

  /** 🟠 A date we cannot read becomes null rather than a guess — a wrong time decides what looks recent. */
  it("leaves the time null rather than guessing at one it cannot read", async () => {
    const call = answering(rss(item("제목", "https://www.hani.co.kr/arti/2", "어제쯤")));
    const [only] = await fetchFeed(NEWS_FEEDS[3]!, hani, { fetch: call });
    expect(only!.publishedAt).toBeNull();
  });

  it("takes only its share, so one publisher cannot bury the others", async () => {
    const many = Array.from({ length: 60 }, (_, index) => item(`제목 ${index}`, `https://www.yna.co.kr/view/A${index}`)).join("");
    const items = await fetchFeed(NEWS_FEEDS[0]!, yna, { fetch: answering(rss(many)) });
    expect(items).toHaveLength(NEWS_FEED_ITEMS_PER_PUBLISHER);
  });

  it("refuses a feed that answers with an error status", async () => {
    await expect(fetchFeed(NEWS_FEEDS[0]!, yna, { fetch: answering("", 503) })).rejects.toThrow();
  });

  /** A feed is a small document. Anything larger is not one, and reading it costs memory for nothing. */
  it("stops reading a feed that will not end", async () => {
    const huge = rss(item("제목", "https://www.yna.co.kr/view/A1")) + "x".repeat(4096);
    await expect(fetchFeed(NEWS_FEEDS[0]!, yna, { fetch: answering(huge), maxBytes: 128 })).rejects.toThrow();
  });
});

describe("gathering every feed", () => {
  const publishers: NewsPublisher[] = NEWS_FEEDS.map((feed, index) => ({
    host: feed.host,
    name: `언론사 ${index}`,
    body: "address",
  }));

  const byHost = (bodies: Record<string, { body?: string; fail?: boolean }>) =>
    vi.fn(async (url: string | URL) => {
      const host = new URL(String(url)).hostname.replace(/^www\./u, "");
      const entry = bodies[host];
      if (!entry || entry.fail) throw new TypeError("fetch failed");
      return new Response(entry.body ?? rss(""), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

  /**
   * 🔴 **One feed failing drops that publisher, not the list.** These are other people's servers and one is
   * always down. Blanking the picker because 뉴시스 timed out would cost somebody the three that answered —
   * and the one that failed is named, because a picker that is quietly short misrepresents today.
   */
  it("keeps the publishers that answered and names the ones that did not", async () => {
    const call = byHost({
      "yna.co.kr": { body: rss(item("연합 기사", "https://www.yna.co.kr/view/A1")) },
      "newsis.com": { fail: true },
      "khan.co.kr": { body: rss(item("경향 기사", "https://www.khan.co.kr/article/1")) },
      "hani.co.kr": { fail: true },
    });

    const { items, unavailable } = await fetchAllFeeds(publishers, { fetch: call });

    // Whoever answered is here; whoever did not is named. The publishers with no entry above fail too.
    expect(items.map((row) => row.host).sort()).toEqual(["khan.co.kr", "yna.co.kr"]);
    expect(unavailable.map((one) => one.host)).toContain("newsis.com");
    expect(unavailable.map((one) => one.host)).toContain("hani.co.kr");
    expect(unavailable.map((one) => one.host)).not.toContain("yna.co.kr");
  });

  /** 🟠 Newest first across publishers, so it reads as today's news rather than four stacks. */
  it("puts the newest first no matter whose feed it came from", async () => {
    const call = byHost({
      "yna.co.kr": { body: rss(item("어제", "https://www.yna.co.kr/view/A1", "Fri, 19 Sep 2026 09:00:00 +0900")) },
      "newsis.com": { body: rss(item("오늘", "https://www.newsis.com/view/B1", "Sat, 20 Sep 2026 09:00:00 +0900")) },
      "sbs.co.kr": { body: rss("") },
      "khan.co.kr": { body: rss("") },
      "hani.co.kr": { body: rss("") },
      "donga.com": { body: rss("") },
    });

    const { items } = await fetchAllFeeds(publishers, { fetch: call });
    expect(items.map((row) => row.title)).toEqual(["오늘", "어제"]);
  });

  /**
   * 🟠 A row with no date sorts last rather than being dropped — the title and the address are still good and
   * only the ordering is unknown. Dropping it would silently shorten the list for a reason nobody can see.
   */
  it("keeps a row with no time, at the end", async () => {
    const call = byHost({
      "yna.co.kr": { body: rss(item("시각 없음", "https://www.yna.co.kr/view/A1", "언제였더라")) },
      "newsis.com": { body: rss(item("시각 있음", "https://www.newsis.com/view/B1")) },
      "sbs.co.kr": { body: rss("") },
      "khan.co.kr": { body: rss("") },
      "hani.co.kr": { body: rss("") },
      "donga.com": { body: rss("") },
    });

    const { items } = await fetchAllFeeds(publishers, { fetch: call });
    expect(items.map((row) => row.title)).toEqual(["시각 있음", "시각 없음"]);
  });

  /**
   * 🔴 The feed list and the publisher list are separate files, and this is what happens when they disagree:
   * a feed whose host is not an allowed publisher is simply not fetched. Nothing on screen, nothing refused
   * later — the allowlist stays the one place that decides who we knock on.
   */
  it("does not fetch a feed whose publisher is not on the list", async () => {
    const call = byHost({ "yna.co.kr": { body: rss(item("연합", "https://www.yna.co.kr/view/A1")) } });
    const { items, unavailable } = await fetchAllFeeds([publishers[0]!], { fetch: call });

    expect(items).toHaveLength(1);
    expect(unavailable).toEqual([]);
  });
});
