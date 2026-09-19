import { Body, Controller, Get, Post } from "@nestjs/common";
import {
  API_ROUTES,
  type NewsFetchArticleResponse,
  type NewsPublisher,
  type NewsReelSetupResponse,
} from "@ai-animation-studio/shared";

import { extractArticle } from "./article-extract.js";
import { NewsCallQuota, NewsQuotaLedgerUnreadableError } from "./news-call-quota.js";
import { NEWS_SOURCE_HOSTS, NewsSourceRefusedError, fetchNewsArticle } from "./news-source.js";

/**
 * The readable name beside each host on the list.
 *
 * 🟠 Kept next to the list rather than in the contract for the same reason the list is: one place, so a host
 * and its name cannot drift apart. A screen showing only `yna.co.kr` is a list its reader does not recognise;
 * a screen showing only 연합뉴스 is a list they cannot match against the address in their hand. Both travel.
 */
const PUBLISHER_NAMES: Record<string, string> = {
  "yna.co.kr": "연합뉴스",
  "newsis.com": "뉴시스",
  "chosun.com": "조선일보",
  "joongang.co.kr": "중앙일보",
  "donga.com": "동아일보",
  "hani.co.kr": "한겨레",
  "khan.co.kr": "경향신문",
  "hankookilbo.com": "한국일보",
  "kbs.co.kr": "KBS",
  "imbc.com": "MBC",
  "sbs.co.kr": "SBS",
  "ytn.co.kr": "YTN",
};

const publishers = (): NewsPublisher[] =>
  NEWS_SOURCE_HOSTS.map((host) => ({ host, name: PUBLISHER_NAMES[host] ?? host }));

/** The publisher a fetched address belongs to, for the screen and for the caption's credit. */
function publisherOf(finalUrl: string): string {
  const host = new URL(finalUrl).hostname.toLowerCase();
  const matched = NEWS_SOURCE_HOSTS.find((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  return matched ? PUBLISHER_NAMES[matched] ?? matched : host;
}

@Controller()
export class NewsController {
  /**
   * The fetch, as a replaceable field rather than a direct call — the same shape `MediaCommandRunner` uses, and
   * for the same reason: a test has to be able to hand this route a page without a network. Shipping code never
   * assigns it, so there is exactly one implementation in the app.
   */
  fetchArticle: typeof fetchNewsArticle = fetchNewsArticle;

  constructor(private readonly quota: NewsCallQuota) {}

  /**
   * What the screen needs before anybody types.
   *
   * 🔴 The two facts are gathered independently on purpose. `usedToday` **throws** when the ledger cannot be
   * read — that is the whole D-036 design and it must not be softened — but a broken ledger file says nothing
   * about which publishers we accept. Catching it here keeps one failure to one thing: the list still arrives,
   * and `dailyCalls` arrives as `null`, which the screen reads as *we cannot tell, so no call* rather than as
   * room to spend. The real call is still gated by `preflight()` regardless of what any screen drew.
   */
  @Get(API_ROUTES.newsReelSetup)
  async setup(): Promise<NewsReelSetupResponse> {
    let dailyCalls: NewsReelSetupResponse["dailyCalls"] = null;
    try {
      dailyCalls = { used: await this.quota.usedToday(), limit: await this.quota.limit() };
    } catch (error) {
      if (!(error instanceof NewsQuotaLedgerUnreadableError)) throw error;
    }
    return { publishers: publishers(), dailyCalls };
  }

  /**
   * Fetch one article.
   *
   * 🔴 **This route spends nothing and must never touch the call ledger.** It is our own network request to a
   * publisher, not a provider call — booking it here would burn the day's summary allowance on a button nobody
   * thought cost anything (Cowork Round 927 §4). `NewsCallQuota.record` is reachable only from the summary
   * route, which is still waiting on 캡틴D.
   *
   * Four outcomes, four different things the screen says. `body_not_found` is **not** grouped with the
   * refusals: we knocked, we got the page, we could not tell which part was the article. The person pastes the
   * body and everything else stays filled in.
   */
  @Post(API_ROUTES.newsArticle)
  async article(@Body() body: unknown): Promise<NewsFetchArticleResponse> {
    const url = typeof (body as { url?: unknown })?.url === "string" ? (body as { url: string }).url.trim() : "";

    let fetched: { finalUrl: string; body: string };
    try {
      fetched = await this.fetchArticle(url);
    } catch (error) {
      if (error instanceof NewsSourceRefusedError) {
        return { outcome: "refused", reason: error.reason, publishers: publishers() };
      }
      // DNS, timeout, reset, a 500 that never produced a page — the address was fine, the connection was not.
      return { outcome: "unreachable", sourceUrl: url };
    }

    const publisher = publisherOf(fetched.finalUrl);
    const extracted = extractArticle(fetched.body);
    // 🔴 `finalUrl`, not what was typed — a redirect makes those different, and crediting someone else's
    // article to the wrong address is a quiet way to be wrong in public.
    if (extracted.body === undefined) {
      return {
        outcome: "body_not_found",
        sourceUrl: fetched.finalUrl,
        publisher,
        // Everything we did manage to read goes with it, so the paste screen opens filled in.
        title: extracted.title,
        publishedAt: extracted.publishedAt ?? null,
      };
    }

    return {
      outcome: "article",
      article: {
        title: extracted.title,
        body: extracted.body,
        publisher,
        publishedAt: extracted.publishedAt ?? new Date().toISOString(),
        sourceUrl: fetched.finalUrl,
      },
    };
  }
}
