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
   * 동아일보: no `<p>` at all — bare text between `<br><br>` straight inside `<section class="news_view">`, and the
   * page's first `<article>` is the reporter box. Every 동아 article came back `body_not_found` until the section
   * was named (2026-09-22, 0 of 10 → 10 of 10). Shaped like the real page, written here rather than copied.
   */
  it("reads 동아일보's body, which is bare text between line breaks in a section", () => {
    const article = extractArticle(page(`
      <article class='author_info'>기자 소개</article>
      <section class="news_view">
        <h2 class='sub_tit'>유엔총회서 기조연설<br />      <br />   </h2>
        <figure class="img_cont"><figcaption>사진 설명 2026.9.21</figcaption></figure>
        ${filler("정상회담")}<br><br>통계청은 3.2%라고 밝혔다.<br><br>
      </section>`));
    expect(article.body).toContain("통계청은 3.2%라고 밝혔다.");
    expect(article.body).not.toContain("기자 소개");
    expect(article.body).not.toContain("사진 설명");
  });

  /** A line of only spaces is a blank line; runs of them must not pile up into a tall gap between paragraphs. */
  it("never leaves more than one blank line, however many space-only lines the markup has", () => {
    const article = extractArticle(page(`<article><p>${filler("물가")}</p>   <br>  <br> <br>  <br>   <p>통계청은 3.2%라고 밝혔다.</p></article>`));
    expect(article.body).not.toMatch(/\n{3,}/);
    expect(article.body).toContain("통계청은 3.2%라고 밝혔다.");
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

  /**
   * 🟠 **No recognised container falls back to the prose, not to the page** — and the difference is the whole
   * rule. Measured (Round 940), the real containers are `content90`, `end-body`, `news_body`, `article-view`:
   * there is no convention to learn, only a list to keep extending, so an unknown name must not mean failure.
   * What it must also not mean is sweeping the document, so the fallback takes **paragraphs**, which is what
   * prose is shaped like.
   */
  it("falls back to the paragraphs when no container is recognised", () => {
    const article = extractArticle(page(`<div class="mystery"><p>${filler("알 수 없는 구조")}</p></div>`));
    expect(article.body).toContain("알 수 없는 구조");
  });

  /**
   * 🔴 And the half that pair used to hold, now stated directly: **a page with no prose on it is still
   * nothing.** A wall of headlines and menu items has plenty of text and not one sentence; taking it would hand
   * `checkNewsSummary` a page of other stories' numbers to vouch with, which is the failure this file exists
   * to prevent. Short items and linked items are both excluded, for the same reason and by different tests.
   */
  it("still returns nothing for a page that is all headlines and menus", () => {
    const headlines = Array.from({ length: 40 }, (_, index) => `<p><a href="/n${index}">코스피 ${index}.8% 급등</a></p>`).join("");
    const menu = Array.from({ length: 40 }, (_, index) => `<p>메뉴 ${index}</p>`).join("");
    expect(extractArticle(page(`<div class="mystery">${headlines}${menu}</div>`)).body).toBeUndefined();
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

describe("article extraction, when the block names are ones we never guessed", () => {
  /**
   * 🔴 **The pair for the half of the defence that fails silently.** `STRIP_PATTERNS` is a list of class names,
   * and a list of names only catches the publishers somebody thought of. This related-article block is named
   * `연관` — nothing in that list matches it — and it still must not reach the body, because every headline in
   * it carries another story's numbers into the place `checkNewsSummary` looks for the summary's.
   *
   * What catches it is structural rather than nominal: its text exists to be clicked, and article prose does
   * not. Measured through the checker, which is the thing that would have gone falsely green.
   */
  it("drops a related list whose class name is not on any list, because its text is all links", () => {
    const html = page(`<article><p>${filler("물가")}</p><p>통계청은 3.2%라고 밝혔다.</p>
      <div class="연관"><p><a href="/a">코스피 7.8% 급등</a></p><p><a href="/b">환율 1,450원 돌파</a></p></div></article>`);
    const article = extractArticle(html);

    expect(article.body).toBeDefined();
    expect(article.body!).not.toContain("7.8");
    expect(article.body!).not.toContain("1,450");
    expect(checkNewsSummary("코스피가 7.8% 올랐다.", article.body!).missing.map((c) => c.text)).toContain("7.8%");
  });

  /**
   * 🟠 And the other side of the same threshold: prose that happens to cite a source is still prose. A rule
   * that cut every paragraph containing a link would quietly shorten real articles — the cheap failure, but
   * still a failure, and one that would make the summariser work from less than the article said.
   */
  it("keeps a paragraph that merely contains a link", () => {
    const article = extractArticle(page(`<article><p>${filler("예산")}</p>
      <p>정부는 <a href="/source">기획재정부 자료</a>에서 3.2%라고 밝혔다. 이 수치는 지난달과 같다.</p></article>`));
    expect(article.body!).toContain("3.2%");
    expect(article.body!).toContain("기획재정부 자료");
  });
});

/**
 * 캡틴D, first real run: 「본문이랑 제목이랑 같게 뜸」. Measured the same hour on live articles — 경향, 한겨레
 * and SBS repeat the headline as the body's first line; 연합뉴스 and 뉴시스 do not.
 */
describe("the headline is not the body's first line", () => {
  const page = (body: string) => `<html><head><meta property="og:title" content="물가 3.2%로 둔화"></head>
    <body><article>${body}</article></body></html>`;
  const sentence = "통계청은 3.2%라고 밝혔다. ".repeat(30);

  it("drops the headline when the body opens with it", () => {
    const extracted = extractArticle(page(`<p>물가 3.2%로 둔화</p><p>${sentence}</p>`));
    expect(extracted.body!.startsWith("물가 3.2%로 둔화")).toBe(false);
    expect(extracted.body).toContain("통계청은");
  });

  /**
   * 🔴 Exact match only. A looser rule — dropping leading lines that do not end like a sentence — was measured
   * and rejected because it eats 뉴시스's `[서울=뉴시스] …` dateline, 103 characters of real article.
   */
  it("keeps a first line that merely resembles the headline", () => {
    const extracted = extractArticle(page(`<p>물가 3.2%로 둔화됐다고 한다</p><p>${sentence}</p>`));
    expect(extracted.body!.startsWith("물가 3.2%로 둔화됐다고")).toBe(true);
  });

  /** 🟠 The publishers that never repeated it must come back byte for byte. */
  it("changes nothing when the body does not open with the headline", () => {
    const extracted = extractArticle(page(`<p>[서울=뉴시스] 반복되는 사건으로</p><p>${sentence}</p>`));
    expect(extracted.body!.startsWith("[서울=뉴시스]")).toBe(true);
  });
});

/**
 * 🔴 Cowork 1084 — 연합뉴스 본문 끝에 **다른 날의 사실**이 붙어 왔다. 30편을 재 보니 전부 저작권 줄에서 기사가 끝나고,
 * 그 뒤로 송고 줄 · 사진 설명(제 날짜·제 장소) · 좋아요/공유 단추 글자가 온다. 사진 설명의 「2026.8.30」이 본문에
 * 남으면 대조가 그걸 **이 기사의 사실**로 본다. 모양은 실물에서 재고, 글은 여기서 지어 썼다.
 */
describe("the publisher's tail is not the article", () => {
  const tail = (caption: string) => [
    "<p>제보는 카카오톡 okjebo</p>",
    "<p>&lt;저작권자(c) 연합뉴스, 무단 전재-재배포, AI 학습 및 활용 금지&gt;</p>",
    "<p>2026/09/22 19:19 송고</p><p>2026년09월22일 19시19분 송고</p>",
    `<p>${caption}</p>`,
    "<p>좋아요</p><p>공유하기</p>",
  ].join("");
  const CAPTION = "(서울=연합뉴스) 서대연 기자 = 대법원 전경. 사진은 30일 서울 서초구 대법원의 모습. 2026.8.30 dwise@yna.co.kr";

  it("ends the body at the copyright line, so a photo caption's date is not the article's", () => {
    const body = extractArticle(page(`<article><p>${filler("재제청")}</p><p>대법원장은 22일 요구를 거부했다.</p>${tail(CAPTION)}</article>`)).body!;

    expect(body.endsWith("대법원장은 22일 요구를 거부했다.")).toBe(true);
    for (const gone of ["송고", "저작권자", "okjebo", "2026.8.30", "dwise@yna.co.kr", "공유하기"]) expect(body, gone).not.toContain(gone);
    // 🔴 이게 이 줄의 이유다: 사진 설명에만 있던 날짜가 대조를 통과하지 못한다.
    expect(checkNewsSummary("사진은 2026.8.30 모습", body).missing.length).toBeGreaterThan(0);
  });

  /** 🟠 400자를 **꼬리 덕분에** 넘기던 단신은 이제 못 넘는다 — 대조할 거리가 모자라다는 원래 규칙 그대로다. */
  it("measures the body without the tail, so a short brief is not made long enough by it", () => {
    const brief = "(서울=연합뉴스) 셀리드는 30억원 유상증자를 결정했다고 22일 공시했다. ".repeat(3);
    const longCaption = `${CAPTION} `.repeat(8);
    expect(brief.length).toBeLessThan(ARTICLE_MIN_BODY_CHARS);

    expect(extractArticle(page(`<article><p>${brief}</p>${tail(longCaption)}</article>`)).body).toBeUndefined();
  });

  it("drops a reporter's address left alone on the last line", () => {
    const body = extractArticle(page(`<article><p>${filler("영화제")}</p><p>young@yna.co.kr</p></article>`)).body!;
    expect(body).not.toContain("young@yna.co.kr");
    expect(body).toContain("영화제");
  });

  it("changes nothing on a page with no copyright line", () => {
    const body = extractArticle(page(`<article><p>${filler("물가")}</p><p>통계청은 3.2%라고 밝혔다.</p></article>`)).body!;
    expect(body.endsWith("통계청은 3.2%라고 밝혔다.")).toBe(true);
  });
});
