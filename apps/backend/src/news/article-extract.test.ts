import { describe, expect, it } from "vitest";

import { checkNewsSummary } from "@ai-animation-studio/shared";

import { ARTICLE_MIN_BODY_CHARS, extractArticle } from "./article-extract.js";

const filler = (label: string) => `${label}에 대한 본문 문장이 이어집니다. `.repeat(20);

const page = (inner: string, head = "") => `<!doctype html><html><head>
<meta property="og:title" content="물가 상승률 3.2%로 둔화">
<meta property="article:published_time" content="2026-09-19T09:00:00+09:00">
${head}</head><body>${inner}</body></html>`;

describe("article extraction", () => {
  it("takes the article out of an <article> container", () => {
    const article = extractArticle(page(`<article><p>${filler("물가")}</p><p>통계청은 3.2%라고 밝혔다.</p></article>`));
    expect(article.title).toBe("물가 상승률 3.2%로 둔화");
    expect(article.publishedAt).toBe("2026-09-19T09:00:00+09:00");
    expect(article.body).toContain("통계청은 3.2%라고 밝혔다.");
  });

  it("takes it from a named article-body div when there is no <article>", () => {
    const article = extractArticle(page(`<div class="story wrap"><div id="article-body"><p>${filler("환율")}</p></div></div>`));
    expect(article.body).toContain("환율");
  });

  /**
   * 🔴 **The pair this file exists for, and it is the *opposite* of the obvious danger.** A body that is too
   * small makes a summary thin (Cowork Round 931 §4) — bad, but every claim in it is genuinely in the text. A
   * body that is too **large** makes `checkNewsSummary` stop guarding: it asks "is this number in the article?",
   * so a related-headline list sweeps in other stories' figures and an **invented** number can be "found" there.
   * Here the article says 3.2% and a related box says 7.8%; a summary claiming 7.8% must not pass.
   */
  it("does not sweep in a related-article list, so another story's numbers cannot vouch for an invented one", () => {
    const html = page(`<article><p>${filler("물가")}</p><p>통계청은 3.2%라고 밝혔다.</p>
      <ul class="related-news"><li>코스피 7.8% 급등</li><li>환율 1,450원 돌파</li></ul></article>`);
    const article = extractArticle(html);
    expect(article.body).toBeDefined();
    expect(article.body!).not.toContain("7.8");
    expect(article.body!).not.toContain("1,450");

    // And measured through the checker itself, which is the thing that would have gone falsely green.
    const invented = checkNewsSummary("코스피가 7.8% 올랐다.", article.body!);
    expect(invented.missing.map((claim) => claim.text)).toContain("7.8%");
  });

  it("drops scripts, styles, ads and share boxes that sit inside the container", () => {
    const article = extractArticle(page(`<article><script>var price = 9999;</script><div class="ad-wrap">특가 5,000원</div>
      <p>${filler("본문")}</p><div class="sns-share">공유하기</div></article>`));
    expect(article.body!).not.toContain("9999");
    expect(article.body!).not.toContain("5,000");
    expect(article.body!).not.toContain("공유하기");
  });

  /**
   * 🔴 A headline-and-blurb stub parses perfectly and is not an article. The summariser would write three
   * accurate sentences about a blurb and the checker would pass every one of them — the half-body failure,
   * arriving as a clean success.
   */
  it("refuses a stub that is too short to be a body, rather than summarising a blurb", () => {
    const stub = extractArticle(page(`<article><p>물가가 둔화됐다.</p></article>`));
    expect(stub.body).toBeUndefined();
    // 🔴 and the metadata survives — this is the paste branch, not a failure.
    expect(stub.title).toBe("물가 상승률 3.2%로 둔화");
    expect(stub.publishedAt).toBe("2026-09-19T09:00:00+09:00");
    expect(ARTICLE_MIN_BODY_CHARS).toBeGreaterThan(200);
  });

  /** No recognised container at all: nothing, so the person pastes. Never the whole page. */
  it("returns nothing rather than falling back to the page body", () => {
    expect(extractArticle(page(`<div class="mystery"><p>${filler("알 수 없는 구조")}</p></div>`)).body).toBeUndefined();
  });

  /**
   * 🔴 Entities have to be decoded before the checker sees the body: it compares quoted strings, and a body
   * still holding `&quot;` would make a real quotation look invented.
   */
  it("decodes entities, so a genuine quotation is not called invented", () => {
    const quote = "재정 건전성은 지킨다";
    const article = extractArticle(page(`<article><p>${filler("예산")}</p><p>&ldquo;${quote}&rdquo;고 말했다. &amp; 그런 듯하다.</p></article>`));
    expect(article.body!).toContain("&");
    expect(article.body!).not.toContain("&amp;");
    const checked = checkNewsSummary(`장관은 “${quote}”고 밝혔다.`, article.body!);
    expect(checked.missing).toHaveLength(0);
  });

  it("does not fuse sentences across paragraphs", () => {
    const article = extractArticle(page(`<article><p>${filler("첫")}</p><p>앞 문장이다</p><p>뒤 문장이다</p></article>`));
    expect(article.body!).not.toContain("앞 문장이다뒤 문장이다");
  });

  /** Publishers write meta attributes in either order; half of them put content= first. */
  it("reads a meta tag whose attributes are in the other order", () => {
    const html = `<!doctype html><html><head><meta content="다른 순서 제목" property="og:title"></head>
      <body><article><p>${filler("순서")}</p></article></body></html>`;
    expect(extractArticle(html).title).toBe("다른 순서 제목");
  });

  it("falls back to <title> when there is no og:title", () => {
    const html = `<!doctype html><html><head><title>타이틀 태그</title></head>
      <body><article><p>${filler("제목")}</p></article></body></html>`;
    expect(extractArticle(html).title).toBe("타이틀 태그");
  });
});
