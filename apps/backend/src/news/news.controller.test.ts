import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NEWS_SUMMARY_MAX_CHARS, isCreateNewsSummaryResponse, isNewsFetchArticleResponse, isNewsReelSetupResponse } from "@ai-animation-studio/shared";

import { NEWS_SOURCE_HOSTS } from "./news-source.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { NewsCallQuota, NEWS_SUMMARY_DAILY_CALL_LIMIT } from "./news-call-quota.js";
import { NewsSummaryProviderError } from "./gemini-summary-adapter.js";
import { NewsController } from "./news.controller.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function controller(): Promise<{ controller: NewsController; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-controller-"));
  roots.push(root);
  return { controller: new NewsController(new NewsCallQuota(root), keyStore("test-key")), root };
}

const article = (body: string) => `<!doctype html><html><head><meta property="og:title" content="제목">
<meta property="article:published_time" content="2026-09-19T09:00:00+09:00"></head>
<body><article><p>${body}</p></article></body></html>`;

const longBody = "본문 문장이 이어집니다. ".repeat(40);

describe("news setup route", () => {
  it("answers a shape the client's guard accepts", async () => {
    const { controller: news } = await controller();
    const setup = await news.setup();
    expect(isNewsReelSetupResponse(setup)).toBe(true);
    expect(setup.dailyCalls).toEqual({ used: 0, limit: NEWS_SUMMARY_DAILY_CALL_LIMIT });
  });

  it("names every publisher, with a readable name beside the host", async () => {
    const { controller: news } = await controller();
    const setup = await news.setup();
    expect(setup.publishers.map((item) => item.host)).toContain("yna.co.kr");
    expect(setup.publishers.find((item) => item.host === "yna.co.kr")?.name).toBe("연합뉴스");
    // Every host has a name that is not just the host repeated — a list its reader does not recognise is not a list.
    expect(setup.publishers.every((item) => item.name !== item.host)).toBe(true);
  });

  /**
   * 🔴 One broken thing stays one broken thing. `usedToday` throws when the ledger cannot be read and that is
   * the whole D-036 design — but a corrupt count file says nothing about which publishers we accept, and a
   * screen that cannot name a single newspaper because of it is a second failure we caused ourselves.
   */
  it("still names the publishers when the ledger cannot be read, and says the count is unknown", async () => {
    const { controller: news, root } = await controller();
    await fs.writeFile(path.join(root, "news_call_usage.json"), "{ not json");

    const setup = await news.setup();
    expect(setup.dailyCalls).toBeNull();
    expect(setup.publishers.length).toBeGreaterThan(0);
  });

  /**
   * 🔴 `null` is "we cannot tell, so we will not call" — never "there is room". The proof that it is not being
   * softened into an empty budget is that the gate underneath still refuses.
   */
  it("keeps the real gate shut when the count came back unknown", async () => {
    const { root } = await controller();
    await fs.writeFile(path.join(root, "news_call_usage.json"), "{ not json");
    await expect(new NewsCallQuota(root).preflight()).rejects.toThrow();
  });
});

describe("news article route", () => {
  it("returns the article, credited to where the body actually came from", async () => {
    const { controller: news } = await controller();
    news.fetchArticle = async () => ({ finalUrl: "https://m.yna.co.kr/view/1", body: article(longBody) });

    const result = await news.article({ url: "https://www.yna.co.kr/view/1" });

    expect(isNewsFetchArticleResponse(result)).toBe(true);
    expect(result).toMatchObject({ outcome: "article" });
    if (result.outcome !== "article") throw new Error("unreachable");
    // 🔴 the redirect target, not what was typed — crediting an article to the wrong address is quietly wrong.
    expect(result.article.sourceUrl).toBe("https://m.yna.co.kr/view/1");
    expect(result.article.publisher).toBe("연합뉴스");
  });

  it("turns a refusal into the refused branch, with the list attached", async () => {
    const { controller: news } = await controller();
    const result = await news.article({ url: "https://192.168.0.1/a" });
    expect(isNewsFetchArticleResponse(result)).toBe(true);
    expect(result).toMatchObject({ outcome: "refused", reason: "private_address" });
    if (result.outcome !== "refused") throw new Error("unreachable");
    expect(result.publishers.length).toBeGreaterThan(0);
  });

  /**
   * 🔴 A page we got but could not split is **not** a refusal, and the difference is the whole branch: a refusal
   * means try something else, this means paste the body here. What we did read travels with it so nothing is
   * retyped (Cowork Round 931 §4).
   */
  it("keeps what it read when the body could not be found, and does not call it a refusal", async () => {
    const { controller: news } = await controller();
    news.fetchArticle = async () => ({
      finalUrl: "https://www.yna.co.kr/view/1",
      body: `<!doctype html><html><head><meta property="og:title" content="제목만 있는 쪽">
        <meta property="article:published_time" content="2026-09-19T09:00:00+09:00"></head><body><div class="mystery">짧다</div></body></html>`,
    });

    const result = await news.article({ url: "https://www.yna.co.kr/view/1" });

    expect(isNewsFetchArticleResponse(result)).toBe(true);
    expect(result).toMatchObject({
      outcome: "body_not_found", publisher: "연합뉴스", title: "제목만 있는 쪽", publishedAt: "2026-09-19T09:00:00+09:00",
    });
  });

  it("reports a connection that failed as unreachable rather than as a refusal", async () => {
    const { controller: news } = await controller();
    news.fetchArticle = async () => { throw new TypeError("fetch failed"); };
    const result = await news.article({ url: "https://www.yna.co.kr/view/1" });
    expect(result).toMatchObject({ outcome: "unreachable" });
  });

  /**
   * 🔴 **Fetching an article spends nothing, and must never touch the day's summary allowance.** Booking a call
   * here would burn the cap on a button nobody thinks costs anything — the separation Cowork drew in Round 927
   * §4 between "다른 사진" (free) and "요약 다시" (counted). The ledger file is the evidence: it must not exist.
   */
  it("never books a call against the day for fetching an article", async () => {
    const { controller: news, root } = await controller();
    news.fetchArticle = async () => ({ finalUrl: "https://www.yna.co.kr/view/1", body: article(longBody) });

    await news.article({ url: "https://www.yna.co.kr/view/1" });
    await news.article({ url: "https://192.168.0.1/a" });
    await news.setup();

    await expect(fs.readFile(path.join(root, "news_call_usage.json"), "utf8")).rejects.toThrow();
    expect(await new NewsCallQuota(root).usedToday()).toBe(0);
  });

  it("refuses a request whose url is missing or not a string", async () => {
    const { controller: news } = await controller();
    for (const body of [{}, { url: 42 }, null, { url: "   " }]) {
      expect(await news.article(body)).toMatchObject({ outcome: "refused", reason: "unsupported_address" });
    }
  });
});

/** A settings repository that answers with whatever key the test wants, and never touches disk. */
function keyStore(value: string | null): ProviderSettingsRepository {
  return { read: async () => value } as unknown as ProviderSettingsRepository;
}

const ARTICLE = {
  title: "물가 상승률 3.2%로 둔화",
  body: "통계청은 3.2%라고 밝혔다. ".repeat(40),
  publisher: "연합뉴스",
  publishedAt: "2026-09-19T09:00:00+09:00",
  sourceUrl: "https://www.yna.co.kr/view/1",
};

async function summariser(key: string | null = "test-key"): Promise<{ controller: NewsController; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-summary-"));
  roots.push(root);
  return { controller: new NewsController(new NewsCallQuota(root), keyStore(key)), root };
}

describe("news summary route", () => {
  it("returns the summary with what checking it produced, in a shape the client's guard accepts", async () => {
    const { controller: news } = await summariser();
    news.callProvider = async () => "통계청에 따르면 물가 상승률은 3.2%로 둔화됐다.";

    const result = await news.summarise({ article: ARTICLE });

    expect(isCreateNewsSummaryResponse(result)).toBe(true);
    expect(result.check.missing).toHaveLength(0);
    expect(result.dailyCalls).toEqual({ used: 1, limit: NEWS_SUMMARY_DAILY_CALL_LIMIT });
  });

  /**
   * 🔴 The check travels back; it is **not** a gate on returning the summary. Somebody who is told only
   * "something was wrong" cannot fix anything — they need to see which figure was invented. The refusal lives
   * on the card button, where it always has.
   */
  it("returns an invented figure rather than hiding it, and says which one", async () => {
    const { controller: news } = await summariser();
    news.callProvider = async () => "물가 상승률이 7.8%로 올랐다.";

    const result = await news.summarise({ article: ARTICLE });

    expect(result.summary).toContain("7.8%");
    expect(result.check.missing.map((claim) => claim.text)).toContain("7.8%");
  });

  /**
   * 🔴 A failed call still counts. It reached the provider and consumed whatever they count, and a cap that
   * only counted successes would let a failing retry loop run all day — the exact shape the cap exists to stop.
   */
  it("books a failed call against the day", async () => {
    const { controller: news, root } = await summariser();
    news.callProvider = async () => { throw new Error("provider down"); };

    await expect(news.summarise({ article: ARTICLE })).rejects.toMatchObject({ response: { code: "NEWS_SUMMARY_FAILED" } });
    expect(await new NewsCallQuota(root).usedToday()).toBe(1);
  });

  /**
   * 🔴 And **why** it failed goes with it. The screen's sentence is the same for every cause, so the ledger is the
   * one place a busy model and a retired one differ — without it, finding out costs another call.
   */
  it("books why a failed call failed, and nothing extra on a success", async () => {
    const { controller: news, root } = await summariser();
    news.callProvider = async () => { throw new NewsSummaryProviderError("refused", 503, "http 503: busy"); };
    await expect(news.summarise({ article: ARTICLE })).rejects.toMatchObject({ response: { code: "NEWS_SUMMARY_FAILED" } });

    news.callCardProvider = async () => { throw new Error("not the adapter's"); };
    await expect(news.cardText({ article: ARTICLE })).rejects.toMatchObject({ response: { code: "NEWS_SUMMARY_FAILED" } });

    news.callProvider = async () => "통계청은 3.2%라고 밝혔다.";
    await news.summarise({ article: ARTICLE });

    const rows = JSON.parse(await fs.readFile(path.join(root, "news_call_usage.json"), "utf8")) as Record<string, unknown>[];
    expect(rows.map((row) => row.failure)).toEqual(["http 503: busy", "unexpected", undefined]);
    expect(await new NewsCallQuota(root).usedToday(), "the rows with a reason still read back").toBe(3);
  });

  /** And the day's allowance closing is our refusal, which the message has to say — not Google's. */
  it("refuses once the day's allowance is gone, and names whose limit it is", async () => {
    const { controller: news, root } = await summariser();
    const quota = new NewsCallQuota(root);
    for (let call = 0; call < NEWS_SUMMARY_DAILY_CALL_LIMIT; call++) await quota.record(true);
    news.callProvider = async () => { throw new Error("must not be called"); };

    await expect(news.summarise({ article: ARTICLE })).rejects.toMatchObject({
      response: { code: "NEWS_DAILY_LIMIT_REACHED" },
    });
    // 🔴 And nothing went out: the eleventh call must not reach them at all.
    expect(await quota.usedToday()).toBe(NEWS_SUMMARY_DAILY_CALL_LIMIT);
  });

  /**
   * 🔴 D-036 at this route's own door. An unreadable ledger is not an empty one, and the one thing that must
   * not happen is a call going out because we could not tell how many had already gone.
   */
  it("refuses rather than calling when the ledger cannot be read", async () => {
    const { controller: news, root } = await summariser();
    await fs.writeFile(path.join(root, "news_call_usage.json"), "{ not json");
    let called = false;
    news.callProvider = async () => { called = true; return "요약"; };

    await expect(news.summarise({ article: ARTICLE })).rejects.toMatchObject({ response: { code: "NEWS_LEDGER_UNREADABLE" } });
    expect(called).toBe(false);
  });

  /**
   * 🟠 No key means no call, so it must not cost a call. Checked before the quota deliberately: booking one
   * would charge somebody for a request that never left this machine.
   */
  it("says which key is missing, and does not spend the day's count finding out", async () => {
    const { controller: news, root } = await summariser(null);
    await expect(news.summarise({ article: ARTICLE })).rejects.toMatchObject({ response: { code: "NEWS_SUMMARY_KEY_MISSING" } });
    expect(await new NewsCallQuota(root).usedToday()).toBe(0);
  });

  /**
   * 🔴 `checkNewsSummary` is only ever true **inside the text it was given**, so a two-line stub produces a
   * summary that passes against a stub. That is the falsely-green case, and it must not cost a call to find.
   */
  it("refuses an article too short to check a summary against, before calling", async () => {
    const { controller: news, root } = await summariser();
    let called = false;
    news.callProvider = async () => { called = true; return "요약"; };

    await expect(news.summarise({ article: { ...ARTICLE, body: "물가가 둔화됐다." } }))
      .rejects.toMatchObject({ response: { code: "NEWS_ARTICLE_INVALID" } });
    expect(called).toBe(false);
    expect(await new NewsCallQuota(root).usedToday()).toBe(0);
  });

  /**
   * 🟠 Reported, never trimmed. Cutting to length can slice `4,000` into `4,0`, and the checker would then see
   * a figure the provider never wrote and call it invented — the guard firing on our own edit.
   */
  it("flags a summary over the card's limit instead of cutting it", async () => {
    const { controller: news } = await summariser();
    const long = `통계청은 3.2%라고 밝혔다. `.repeat(40);
    news.callProvider = async () => long;

    const result = await news.summarise({ article: ARTICLE });
    expect(result.tooLong).toBe(true);
    expect(result.summary).toBe(long);
    expect(result.summary.length).toBeGreaterThan(NEWS_SUMMARY_MAX_CHARS);
  });

  it("does not flag a summary that fits", async () => {
    const { controller: news } = await summariser();
    news.callProvider = async () => "통계청은 3.2%라고 밝혔다.";
    expect((await news.summarise({ article: ARTICLE })).tooLong).toBeUndefined();
  });
});

describe("what the screen is told about each publisher", () => {
  /**
   * 🔴 Every host has both facts, and this is what makes the merged table worth having. A name table on its
   * own lets somebody add a publisher, ship it, and leave the body question for whoever pastes the first
   * address to discover. Here, adding a host with no entry reddens this before it reaches anybody.
   */
  it("says a readable name and a measured body answer for every publisher", async () => {
    const { controller: news } = await controller();
    const { publishers } = await news.setup();

    expect(publishers).toHaveLength(NEWS_SOURCE_HOSTS.length);
    for (const publisher of publishers) {
      expect(publisher.name, publisher.host).not.toBe(publisher.host);
      expect(["address", "varies", "paste", "unknown"], publisher.host).toContain(publisher.body);
    }
  });

  /**
   * 🔴 **`unknown` has to be reachable, and the pair exists to stop it being tidied away.** Two publishers were
   * not sampled — their entry pages did not expose article links the sampler recognises — and the tempting fix
   * is to write down whichever answer looks likely. An invented answer is never re-measured, because it
   * already looks answered.
   *
   * 🟠 한겨레 is why the value earns its keep: `unknown` after one article that failed to connect, `address`
   * after four. The first reading was not a fact about 한겨레, it was a fact about that afternoon.
   */
  it("keeps 'not measured' as its own answer rather than guessing either way", async () => {
    const { controller: news } = await controller();
    const { publishers } = await news.setup();

    const unmeasured = publishers.filter((publisher) => publisher.body === "unknown");
    expect(unmeasured.length).toBeGreaterThan(0);
    // And it is a different value from both real answers, so a screen has to branch on it.
    expect(unmeasured.every((publisher) => publisher.body !== "address" && publisher.body !== "paste")).toBe(true);
  });

  /**
   * 🔴 The two failures are different facts, so they are different values (Cowork Round 942 §5). "This site
   * draws its article with JavaScript" is a property of the site — MBC's article page is 4KB holding 162
   * characters of text — and will not differ per article. "This article was not where we look" might.
   * A boolean would make the screen say one sentence about both.
   */
  it("separates a publisher that never works from one that sometimes does", async () => {
    const { controller: news } = await controller();
    const { publishers } = await news.setup();
    const bodyOf = (host: string) => publishers.find((publisher) => publisher.host === host)?.body;

    expect(bodyOf("imbc.com")).toBe("paste");
    // 동아 was the one `varies`; its body container is known now and ten of ten came back (2026-09-22).
    expect(bodyOf("donga.com")).toBe("address");
    expect(bodyOf("yna.co.kr")).toBe("address");
    expect(bodyOf("imbc.com")).not.toBe(bodyOf("donga.com"));
  });
});

/**
 * 🔴 The paid route that fills the card's four boxes. Same five steps as the summary, same money, same
 * refusals — the one thing that differs is what the provider is asked for, and that is exactly the thing the
 * first real reel got wrong (a summary cut into pieces, 271 characters into a line that holds 15).
 */
describe("news reel card text route", () => {
  const ANSWER = [
    "제목1: 물가 오름세 한풀 꺾여",
    "제목2: 3.2%로 둔화",
    "자막1: 통계청 9월 발표",
  ].join("\n");

  it("returns the boxes the provider filled, and the day's count with them", async () => {
    const { controller: news } = await summariser();
    news.callCardProvider = async () => ANSWER;

    const result = await news.cardText({ article: ARTICLE });

    expect(result.values["headline.line1"]).toBe("물가 오름세 한풀 꺾여");
    expect(result.values["headline.line2"]).toBe("3.2%로 둔화");
    expect(result.missing, "자막 둘째 줄은 없어도 됩니다").toEqual([]);
    expect(result.dailyCalls).toEqual({ used: 1, limit: NEWS_SUMMARY_DAILY_CALL_LIMIT });
  });

  /**
   * 🔴 **대조가 카드의 줄 위에서 돕니다.** 구워지는 것이 이 줄들이니, 기사에서 찾아야 하는 것도 이 줄들입니다.
   * 요약을 검사하고 다른 것을 구우면 엉뚱한 글을 검사한 것입니다.
   */
  it("checks the lines themselves, so a figure invented in the caption is caught too", async () => {
    const { controller: news } = await summariser();
    news.callCardProvider = async () => "제목1: 물가 오름세 한풀 꺾여\n제목2: 3.2%로 둔화\n자막1: 지난해는 7.8%였다";

    const result = await news.cardText({ article: ARTICLE });

    expect(result.check.missing.map((claim) => claim.text)).toContain("7.8%");
    expect(result.values["caption.line1"], "지어낸 줄도 돌려줍니다 — 감추면 고칠 수가 없습니다").toContain("7.8%");
  });

  /** 🔴 돈이 나간 답입니다. 한 칸이 비어 왔다고 통째로 거절하면 돈은 나가고 남는 게 없습니다. */
  it("hands back an incomplete answer and names the box that is missing", async () => {
    const { controller: news } = await summariser();
    news.callCardProvider = async () => "물론입니다!\n제목1: 물가 오름세 한풀 꺾여\n자막1: 통계청 9월 발표";

    const result = await news.cardText({ article: ARTICLE });

    expect(result.missing).toEqual(["headline.line2"]);
    expect(result.ignored, "못 읽은 줄도 버렸다고 말합니다").toEqual(["물론입니다!"]);
    expect(result.values["headline.line1"], "읽은 것은 그대로 옵니다").toBeTruthy();
  });

  /** 🔴 길이는 여기서 안 자릅니다 — 자르면 사람은 무엇을 잃었는지 모른 채 칸을 받습니다. */
  it("does not trim a line that ran long", async () => {
    const { controller: news } = await summariser();
    const long = "가".repeat(40);
    news.callCardProvider = async () => `제목1: ${long}\n제목2: 3.2%로 둔화\n자막1: 통계청 9월 발표`;

    const result = await news.cardText({ article: ARTICLE });

    expect(result.values["headline.line1"]).toBe(long);
  });

  it("books a failed call against the day here too", async () => {
    const { controller: news } = await summariser();
    news.callCardProvider = async () => { throw new Error("provider down"); };

    await expect(news.cardText({ article: ARTICLE })).rejects.toThrow();
    const after = await summariserUsed(news);
    expect(after, "부른 것은 부른 것입니다").toBe(1);
  });

  /** 🔴 키가 없으면 나간 요청이 없습니다 — 안 나간 요청을 하루에서 깎으면 사람이 손해를 봅니다. */
  it("spends nothing when there is no key", async () => {
    const { controller: news } = await summariser(null);
    let called = false;
    news.callCardProvider = async () => { called = true; return ANSWER; };

    await expect(news.cardText({ article: ARTICLE })).rejects.toThrow();
    expect(called).toBe(false);
    expect(await summariserUsed(news)).toBe(0);
  });

  /** 🟠 본문이 너무 짧으면 대조가 무의미합니다 — 그걸 알아내는 데 돈을 쓰지 않습니다. */
  it("refuses a body too short to check before anything is spent", async () => {
    const { controller: news } = await summariser();
    let called = false;
    news.callCardProvider = async () => { called = true; return ANSWER; };

    await expect(news.cardText({ article: { ...ARTICLE, body: "짧다." } })).rejects.toThrow();
    expect(called).toBe(false);
  });
});

/** The day's count as the route itself would read it. */
async function summariserUsed(news: NewsController): Promise<number> {
  return (news as unknown as { quota: { usedToday: () => Promise<number> } }).quota.usedToday();
}
