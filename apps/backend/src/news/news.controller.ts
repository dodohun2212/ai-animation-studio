import { Body, Controller, Get, Post } from "@nestjs/common";
import {
  API_ROUTES,
  NEWS_REEL_PICTURE_NAME_LIMIT,
  NEWS_SUMMARY_MAX_CHARS,
  PHOTO_CARD_MAX_PICTURES,
  assertNewsSummaryCheck,
  checkNewsSummary,
  type CreateNewsReelCardTextResponse,
  type CreateNewsSummaryResponse,
  type NewsArticleInput,
  type NewsFetchArticleResponse,
  type NewsPublisher,
  type NewsPublisherBody,
  type NewsReelSetupResponse,  type NewsFeedResponse,
} from "@ai-animation-studio/shared";

import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ARTICLE_MIN_BODY_CHARS, extractArticle } from "./article-extract.js";
import { NewsSummaryProviderError, summariseArticle, writeNewsReelCardText } from "./gemini-summary-adapter.js";
import { parseNewsReelCardText } from "./news-reel-card-text.js";
import { NewsCallQuota, NewsDailyQuotaExceededError, NewsQuotaLedgerUnreadableError } from "./news-call-quota.js";
import { fetchAllFeeds } from "./news-feed.js";
import { NEWS_SOURCE_HOSTS, NewsSourceRefusedError, fetchNewsArticle } from "./news-source.js";
import { newsDailyLimitReached, newsLedgerUnreadable, newsSummaryArticleInvalid, newsSummaryFailed, newsSummaryKeyMissing } from "./news-api.error.js";

/**
 * What this app knows about each publisher: the readable name, and whether its article body can be read
 * from an address alone.
 *
 * 🟠 One table rather than two, so **adding a publisher forces both decisions**. A name table on its own
 * invites somebody to add a host, ship it, and leave the body question to be discovered by whoever pastes
 * the first address.
 *
 * 🔴 **`body` is measured, and the measurement is written here so the next person knows what to redo.**
 * Four articles per publisher, fetched with this app's own code on 2026-09-19 (캡틴D approved the reading,
 * Cowork Round 936 §1):
 *
 *     주소만으로 됨 (4/4)   연합 · 뉴시스 · 중앙 · 한겨레 · 경향 · 한국일보
 *     기사마다 다름 (3/4)   동아 — 2026-09-22 에 0/4 로 재측정, 원인은 본문 틀(`section.news_view`)을 몰랐던 것.
 *                          틀을 알려 준 뒤 그날 목록의 동아 10건이 10/10 → `address`
 *     본문이 HTML 에 없음   MBC · SBS · YTN — 기사 페이지가 4KB 에 글자 162자(MBC), 81자(SBS)다
 *     모름                 조선 · KBS
 *
 * 🔴 The two `unknown`s are a limit of the measurement, not a fact about those sites: their entry pages did
 * not expose article links the sampler recognises. Writing them down as "works" or "needs pasting" would be
 * inventing a result — and an invented one is never re-measured, because it already looks answered.
 *
 * 🟠 한겨레 was `unknown` after one article (a connection failure) and is `address` after four. That is the
 * whole argument for the value existing: the first reading was not a fact about 한겨레, it was a fact about
 * that afternoon.
 */
const PUBLISHER_FACTS: Record<string, { name: string; body: NewsPublisherBody }> = {
  "yna.co.kr": { name: "연합뉴스", body: "address" },
  "newsis.com": { name: "뉴시스", body: "address" },
  "chosun.com": { name: "조선일보", body: "unknown" },
  "joongang.co.kr": { name: "중앙일보", body: "address" },
  "donga.com": { name: "동아일보", body: "address" },
  "hani.co.kr": { name: "한겨레", body: "address" },
  "khan.co.kr": { name: "경향신문", body: "address" },
  "hankookilbo.com": { name: "한국일보", body: "address" },
  "kbs.co.kr": { name: "KBS", body: "unknown" },
  "imbc.com": { name: "MBC", body: "paste" },
  /*
   * 🔴 `paste` → `address`, measured 2026-09-20 on a live article: the body comes back at 2,537 characters,
   * eighteen sentences of it. The old classification came from sampling before the feed existed and has been
   * telling people 「본문은 붙여넣어야 합니다」 about a publisher that parses fine — a warning that costs
   * somebody the work it claims to save them.
   */
  "sbs.co.kr": { name: "SBS", body: "address" },
  "ytn.co.kr": { name: "YTN", body: "paste" },
};

const publishers = (): NewsPublisher[] =>
  NEWS_SOURCE_HOSTS.map((host) => {
    const known = PUBLISHER_FACTS[host];
    // 🔴 A host with no entry answers `unknown` rather than guessing. The pair below demands an entry for
    // every host, so this branch is unreachable today — it exists so that the day it is reached, the screen
    // says "we have not measured" instead of promising something nobody checked.
    return { host, name: known?.name ?? host, body: known?.body ?? "unknown" };
  });

/** The publisher a fetched address belongs to, for the screen and for the caption's credit. */
function publisherOf(finalUrl: string): string {
  const host = new URL(finalUrl).hostname.toLowerCase();
  const matched = NEWS_SOURCE_HOSTS.find((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  return matched ? PUBLISHER_FACTS[matched]?.name ?? matched : host;
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
  /** The card-text call, replaceable for the same reason and never assigned by shipping code. */
  callCardProvider: typeof writeNewsReelCardText = writeNewsReelCardText;
  /** The feed read, replaceable for the same reason — four publishers' servers, never reached from a test. */
  fetchFeeds: typeof fetchAllFeeds = fetchAllFeeds;

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
   * Today's articles, so nobody types an address.
   *
   * 🔴 **Free, and it must stay that way.** Four RSS documents from the publishers themselves — no key, no
   * account, no provider — so this route, like `newsArticle`, never touches the call ledger. The one paid step
   * in this feature is still only the summary.
   *
   * 🟠 A publisher whose feed did not answer comes back in `unavailable` rather than taking the list down with
   * it; `fetchAllFeeds` explains why. The screen can say which one is missing, and pasting one of its articles
   * by hand still works exactly as before.
   */
  @Get(API_ROUTES.newsFeed)
  async feed(): Promise<NewsFeedResponse> {
    return this.fetchFeeds(publishers());
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
    } catch (error) {
      // Booked before the refusal is thrown: the call went out. The reason goes with it — the screen's sentence
      // is the same for every cause, so the ledger is the one place a busy model and a retired one differ.
      await this.quota.record(false, undefined, failureOf(error)).catch(() => undefined);
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

  /**
   * The card's four lines, from one article.
   *
   * 🟠 **Same five steps, same order, same reasons as `summarise` above** — article first so a body we cannot
   * use costs nothing, `preflight()` before anything goes out, the call, `record()` whether it worked or not,
   * then the check. The one thing that differs is what is asked for.
   *
   * 🔴 **The check runs on the four lines, not on a paragraph about them.** These lines are what gets burned
   * under a real publisher's name, so these are the words that have to be found in the article. Checking a
   * summary and then burning something else would be checking the wrong text.
   *
   * 🔴 **Nothing here is a gate, and nothing here is trimmed.** A line that ran long, a box the model skipped,
   * a sentence it wrote outside the labels — all of it comes back as it arrived. The call was paid for; a
   * refusal at this point spends the money and returns nothing, while the screen's four boxes already count
   * characters and are where a person finishes the job.
   */
  @Post(API_ROUTES.newsReelCardText)
  async cardText(@Body() body: unknown): Promise<CreateNewsReelCardTextResponse> {
    const article = validArticle(body);
    // Before the key and the quota, like the article: pictures we cannot use must not cost a call.
    const pictures = validPictures(body);

    const apiKey = (await this.settings.read("gemini"))?.trim();
    if (!apiKey) throw newsSummaryKeyMissing();

    try {
      await this.quota.preflight();
    } catch (error) {
      if (error instanceof NewsDailyQuotaExceededError) throw newsDailyLimitReached(error.used, error.limit);
      if (error instanceof NewsQuotaLedgerUnreadableError) throw newsLedgerUnreadable();
      throw error;
    }

    let answer: string;
    try {
      answer = await this.callCardProvider(article, pictures, apiKey);
    } catch (error) {
      await this.quota.record(false, undefined, failureOf(error)).catch(() => undefined);
      throw newsSummaryFailed();
    }
    await this.quota.record(true);

    const parsed = parseNewsReelCardText(answer, pictures.length);
    // 🟠 Every line joined, because the checker looks inside one text — and a figure invented in the third
    // picture's caption is no better than one invented in the headline.
    const lines = [...Object.values(parsed.headline), ...parsed.captions.flatMap((caption) => Object.values(caption))];
    const check = checkNewsSummary(lines.join("\n"), article.body);
    assertNewsSummaryCheck(check);

    return {
      headline: parsed.headline,
      captions: parsed.captions,
      missing: parsed.missing,
      repeated: parsed.repeated,
      ignored: parsed.ignored,
      check,
      dailyCalls: { used: await this.quota.usedToday(), limit: await this.quota.limit() },
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
/**
 * The reel's pictures by name, in order (docs/06_DECISIONS.md D-057). 🔴 `sceneCount` is refused by name rather than
 * ignored: a client still sending the count would otherwise be told only that `pictures` is missing, and the
 * count is exactly what this field replaced. 🟠 An empty name is allowed — it is what an unnamed picture is.
 */
function validPictures(body: unknown): string[] {
  const candidate = body as { pictures?: unknown; sceneCount?: unknown };
  if (candidate.sceneCount !== undefined) {
    throw newsSummaryArticleInvalid("그림 수(sceneCount) 대신 그림 이름 목록(pictures)을 보내야 합니다.");
  }
  const pictures = candidate.pictures;
  if (!Array.isArray(pictures) || pictures.length < 1 || pictures.length > PHOTO_CARD_MAX_PICTURES) {
    throw newsSummaryArticleInvalid(`그림은 1장부터 ${PHOTO_CARD_MAX_PICTURES}장까지입니다.`);
  }
  if (!pictures.every((name): name is string => typeof name === "string" && name.trim().length <= NEWS_REEL_PICTURE_NAME_LIMIT)) {
    throw newsSummaryArticleInvalid(`그림 이름은 글자이고 ${NEWS_REEL_PICTURE_NAME_LIMIT}자 이내여야 합니다.`);
  }
  return pictures;
}

/** What the ledger keeps about a failed call: the adapter's reason, or that something else threw. */
function failureOf(error: unknown): string {
  return error instanceof NewsSummaryProviderError ? error.failure : "unexpected";
}

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
