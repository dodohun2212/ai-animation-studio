import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isNewsFetchArticleResponse, isNewsReelSetupResponse } from "@ai-animation-studio/shared";

import { NewsCallQuota } from "./news-call-quota.js";
import { NewsController } from "./news.controller.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function controller(): Promise<{ controller: NewsController; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-controller-"));
  roots.push(root);
  return { controller: new NewsController(new NewsCallQuota(root)), root };
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
    expect(setup.dailyCalls).toEqual({ used: 0, limit: 10 });
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
