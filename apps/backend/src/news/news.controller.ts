import { Body, Controller, Get, Post } from "@nestjs/common";
import {
  API_ROUTES,
  NEWS_SUMMARY_MAX_CHARS,
  assertNewsSummaryCheck,
  checkNewsSummary,
  type CreateNewsSummaryResponse,
  type NewsArticleInput,
  type NewsFetchArticleResponse,
  type NewsPublisher,
  type NewsReelSetupResponse,
} from "@ai-animation-studio/shared";

import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ARTICLE_MIN_BODY_CHARS, extractArticle } from "./article-extract.js";
import { summariseArticle } from "./gemini-summary-adapter.js";
import { NewsCallQuota, NewsDailyQuotaExceededError, NewsQuotaLedgerUnreadableError } from "./news-call-quota.js";
import { NEWS_SOURCE_HOSTS, NewsSourceRefusedError, fetchNewsArticle } from "./news-source.js";
import { newsDailyLimitReached, newsLedgerUnreadable, newsSummaryArticleInvalid, newsSummaryFailed, newsSummaryKeyMissing } from "./news-api.error.js";

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
  /** The provider call, replaceable for the same reason and never assigned by shipping code. */
  callProvider: typeof summariseArticle = summariseArticle;

  constructor(private readonly quota: NewsCallQuota, private readonly settings: ProviderSettingsRepository) {}

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
  /**
   * The one paid-capable step in this feature.
   *
   * The order is the design, and every line of it was paid for somewhere else in this repository:
   *
   *   1. the article is checked first, because a body we cannot summarise must not cost a call;
   *   2. `preflight()` refuses **before** anything goes out, and refuses rather than assuming zero when the
   *      ledger cannot be read (D-036);
   *   3. the provider is called;
   *   4. `record()` books it **whether it succeeded or not** — a request that reached them consumed whatever
   *      they count, and a cap that only counted successes would let a failing retry loop run all day;
   *   5. the summary is checked against the article, and the check travels back with it.
   *
   * 🔴 Step 5 is not a gate here. A summary that invented a figure is exactly what somebody needs to see —
   * refusing to return it would leave them with "something was wrong" and no way to know what. The refusal
   * lives on the card button, where it always has.
   */
  @Post(API_ROUTES.newsSummaries)
  async summarise(@Body() body: unknown): Promise<CreateNewsSummaryResponse> {
    const article = validArticle(body);

    const apiKey = (await this.settings.read("gemini"))?.trim();
    // Before the quota on purpose: with no key there is no call to count, and booking one against the day
    // would charge somebody for a request that never left this machine.
    if (!apiKey) throw newsSummaryKeyMissing();

    try {
      await this.quota.preflight();
    } catch (error) {
      if (error instanceof NewsDailyQuotaExceededError) throw newsDailyLimitReached(error.used, error.limit);
      if (error instanceof NewsQuotaLedgerUnreadableError) throw newsLedgerUnreadable();
      throw error;
    }

    let summary: string;
    try {
      summary = await this.callProvider(article, apiKey);
    } catch {
      // Booked before the refusal is thrown: the call went out.
      await this.quota.record(false).catch(() => undefined);
      throw newsSummaryFailed();
    }
    await this.quota.record(true);

    const check = checkNewsSummary(summary, article.body);
    // The same refusal the contract's guard makes at the other end — `missing` disagreeing with `claims` would
    // let an invented figure reach the card flow marked clean.
    assertNewsSummaryCheck(check);

    return {
      summary,
      check,
      dailyCalls: { used: await this.quota.usedToday(), limit: await this.quota.limit() },
      // Reported, never trimmed: cutting to length can slice `4,000` into `4,0`, and the checker would then
      // see a figure the provider never wrote and call it invented.
      ...(summary.length > NEWS_SUMMARY_MAX_CHARS ? { tooLong: true as const } : {}),
    };
  }
}

/**
 * 🔴 `body` is required and must be real text, and this is the only place that can insist.
 *
 * `checkNewsSummary` is only ever true **inside the text it was given**, so an empty or near-empty article
 * makes every claim in the summary "missing" — or, worse, makes a two-line stub produce a summary that passes.
 * Neither is something to spend a call discovering.
 */
function validArticle(body: unknown): NewsArticleInput {
  const article = (body as { article?: unknown } | null)?.article as NewsArticleInput | undefined;
  if (!article || typeof article !== "object") throw newsSummaryArticleInvalid();
  const strings = ["title", "body", "publisher", "publishedAt", "sourceUrl"] as const;
  if (strings.some((key) => typeof article[key] !== "string")) throw newsSummaryArticleInvalid();
  if (article.body.trim().length < ARTICLE_MIN_BODY_CHARS) {
    throw newsSummaryArticleInvalid("기사 본문이 요약하기에 너무 짧습니다. 본문 전체를 넣어 주세요.");
  }
  return article;
}
