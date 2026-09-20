import { type NewsFeedItem, type NewsPublisher } from "@ai-animation-studio/shared";

import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";
import { assertAllowedNewsUrl, NEWS_FETCH_TIMEOUT_MS } from "./news-source.js";

/**
 * Where today's articles come from, so nobody has to type an address.
 *
 * 캡틴D: 「뉴스 릴은 내가 직접 주소를 쳐야하잖아. 그게 너무 귀찮은데 그냥 뉴스 서버에 연결해가지고 내
 * 프로그램에서 클릭하면 그걸로 선택되게 할 수는 없나?」
 *
 * 🔴 **A feed is a list of addresses, not a source of trust.** Clicking a row does exactly what typing that
 * address does: it goes to `fetchNewsArticle`, through `assertAllowedNewsUrl`, with every redirect re-checked.
 * This file removes the typing and nothing else. If a feed ever advertised an address outside the allowlist,
 * the next step refuses it the same way it refuses one somebody pasted.
 *
 * 🟢 **Free.** RSS, no key, no account, no provider — the paid part of the news reel is still only the summary.
 */

/**
 * 🔴 **Every publisher with a feed, not only the ones whose body parses.**
 *
 * The first draft here left out 「본문을 붙여넣어야 하는」 publishers, reasoning that a click ending in
 * 「본문을 못 찾았습니다」 is a dead end. 캡틴D asked why MBC·SBS·YTN were missing, and the reasoning was
 * wrong: `body_not_found` is **not** a dead end, it is one remaining step — the address, the title, the
 * publisher and the date all arrive filled in, and only the body is pasted. Typing the address was the thing
 * being complained about, and a click removes it either way.
 *
 * 🟠 So the screen says which is which (it already groups `NewsPublisher.body` four ways), and this list is
 * simply everyone whose feed answers. Measured 2026-09-20:
 *
 * ```
 * 연합뉴스 120 · 뉴시스 99 · SBS 102 · 경향 50 · 한겨레 30 · 동아 10
 * MBC   feed address returns an HTML page  ·  YTN  404  ·  중앙·한국일보  not found yet
 * ```
 *
 * A publisher absent from here is not broken — pasting one of its articles by hand works exactly as before.
 */
export const NEWS_FEEDS: readonly { host: string; url: string }[] = [
  { host: "yna.co.kr", url: "https://www.yna.co.kr/rss/news.xml" },
  { host: "newsis.com", url: "https://www.newsis.com/RSS/society.xml" },
  { host: "sbs.co.kr", url: "https://news.sbs.co.kr/news/newsflashRssFeed.do" },
  { host: "khan.co.kr", url: "https://www.khan.co.kr/rss/rssdata/total_news.xml" },
  { host: "hani.co.kr", url: "https://www.hani.co.kr/rss/" },
  { host: "donga.com", url: "https://www.donga.com/news/rss" },
];

/**
 * 🟠 **Measured, not guessed.** SBS's flash feed is 834KB — feeds are not always small, and a 1MB cap would
 * have sat 20% from the edge of a document somebody else controls. Two, the same ceiling an article gets.
 */
export const NEWS_FEED_MAX_BYTES = 2 * 1024 * 1024;

/** How many rows one publisher may contribute, so 연합뉴스's 120 cannot bury the other three. */
export const NEWS_FEED_ITEMS_PER_PUBLISHER = 20;

interface FeedDeps {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

const stripCdata = (raw: string): string => {
  const match = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/u.exec(raw);
  return (match ? match[1]! : raw).trim();
};

/**
 * 🟠 Entities are decoded because feed titles are full of them — `&amp;`, `&#39;` — and a title that reads
 * 「물가 &amp; 금리」 on screen is the sort of thing somebody assumes is our bug.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    // Last, so an escaped ampersand cannot resurrect the entity beside it.
    .replace(/&amp;/gu, "&");
}

const tagText = (block: string, tag: string): string | null => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "iu").exec(block);
  return match ? decodeEntities(stripCdata(match[1]!)) : null;
};

/**
 * The picture a feed advertised, if it advertised one.
 *
 * 🔴 **Three of six carry one** (measured 2026-09-20): 연합뉴스 in `media:content`, SBS in `enclosure` and
 * `media:thumbnail` both, 동아 in `media:content`. 뉴시스, 경향 and 한겨레 carry none at all — so `null` is an
 * ordinary answer here, not a failure, and the screen is told to draw it as one.
 *
 * 🟠 **https only.** An http image on an https page is blocked by the browser before it is drawn, so keeping
 * one would put a broken frame on screen instead of nothing. Anything that is not a URL at all is dropped the
 * same way.
 *
 * 🔴 These addresses live on the publisher's image host — `img.yna.co.kr`, `img.sbs.co.kr` — which is **not**
 * the article host, so they are deliberately not run through `assertAllowedNewsUrl`. That guard exists because
 * this server is about to open a connection; here it never does. The address goes into an `<img src>` and the
 * browser fetches it, exactly as it would any other picture on a page.
 */
function imageFrom(block: string): string | null {
  const patterns = [
    /<enclosure\b[^>]*\btype="image\/[^"]*"[^>]*>/iu,
    /<media:thumbnail\b[^>]*>/iu,
    /<media:content\b[^>]*\btype="image\/[^"]*"[^>]*>/iu,
  ];
  for (const pattern of patterns) {
    const tag = pattern.exec(block)?.[0];
    const raw = tag ? /\burl="([^"]+)"/iu.exec(tag)?.[1] : undefined;
    if (!raw) continue;
    try {
      const url = new URL(decodeEntities(raw));
      if (url.protocol === "https:") return url.toString();
    } catch {
      // A malformed address is no address. The row keeps its title and link.
    }
  }
  return null;
}

/**
 * 🟠 RSS dates are RFC 822 and Atom's are ISO; `Date` reads both, and anything it cannot read becomes `null`
 * rather than a guess. A wrong timestamp on a news list is worse than none — it decides what looks recent.
 */
function isoDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * 🔴 The address from the feed goes through the **same door** as a typed one. A feed that advertised another
 * host — a syndication partner, a tracking redirector — would be refused here, before it is ever shown, so a
 * row on screen is always a row the next step is willing to fetch.
 */
function itemsFrom(xml: string, publisher: NewsPublisher, limit: number): NewsFeedItem[] {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/giu) ?? [];
  const items: NewsFeedItem[] = [];
  for (const block of blocks) {
    if (items.length >= limit) break;
    const title = tagText(block, "title");
    const link = tagText(block, "link");
    if (!title || !link) continue;
    try {
      const url = assertAllowedNewsUrl(link);
      if (url.hostname !== publisher.host && !url.hostname.endsWith(`.${publisher.host}`)) continue;
      items.push({
        title,
        url: url.toString(),
        publisher: publisher.name,
        host: publisher.host,
        publishedAt: isoDate(tagText(block, "pubDate") ?? tagText(block, "published") ?? tagText(block, "date")),
        imageUrl: imageFrom(block),
      });
    } catch {
      // One unusable row is not a broken feed. The rest of the publisher's articles still stand.
      continue;
    }
  }
  return items;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("feed too large");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { joined.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder("utf-8").decode(joined);
}

/**
 * Read one publisher's feed. Throws on anything at all — the caller turns that into "this publisher is not
 * available right now" rather than a failed request.
 */
export async function fetchFeed(
  feed: { host: string; url: string },
  publisher: NewsPublisher,
  deps: FeedDeps = {},
): Promise<NewsFeedItem[]> {
  const call = deps.fetch ?? globalThis.fetch;
  assertRealNetworkCallAllowed("news feed", call);
  const response = await call(feed.url, {
    redirect: "follow",
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(deps.timeoutMs ?? NEWS_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`feed responded ${response.status}`);
  const xml = await readBoundedText(response, deps.maxBytes ?? NEWS_FEED_MAX_BYTES);
  return itemsFrom(xml, publisher, NEWS_FEED_ITEMS_PER_PUBLISHER);
}

/**
 * Every feed, gathered.
 *
 * 🔴 **One publisher failing drops that publisher, not the list.** These are other people's servers and one of
 * them is always down; blanking the picker because 뉴시스 timed out would cost somebody the three that did
 * answer. The ones that failed are named in `unavailable`, because a picker that is quietly short is a picker
 * that misrepresents what is available today.
 *
 * 🟠 They are fetched together rather than in turn: four sequential timeouts is a screen that sits blank for
 * the better part of a minute, and they have nothing to do with each other.
 */
export async function fetchAllFeeds(
  publishers: readonly NewsPublisher[],
  deps: FeedDeps = {},
): Promise<{ items: NewsFeedItem[]; unavailable: NewsPublisher[] }> {
  const planned = NEWS_FEEDS.map((feed) => ({ feed, publisher: publishers.find((item) => item.host === feed.host) }))
    .filter((entry): entry is { feed: { host: string; url: string }; publisher: NewsPublisher } => !!entry.publisher);

  const settled = await Promise.all(planned.map(async (entry) =>
    fetchFeed(entry.feed, entry.publisher, deps).then(
      (items) => ({ ok: true as const, items }),
      () => ({ ok: false as const, publisher: entry.publisher }),
    )));

  const items = settled.flatMap((result) => (result.ok ? result.items : []));
  const unavailable = settled.flatMap((result) => (result.ok ? [] : [result.publisher]));

  /*
   * 🟠 Newest first, across publishers, so the list reads as "today's news" rather than as four separate
   * publishers stacked. A row with no date sorts last rather than being dropped — the title and the address
   * are still good, and only the ordering is unknown.
   */
  items.sort((left, right) => {
    if (!left.publishedAt) return right.publishedAt ? 1 : 0;
    if (!right.publishedAt) return -1;
    return right.publishedAt.localeCompare(left.publishedAt);
  });

  return { items, unavailable };
}
