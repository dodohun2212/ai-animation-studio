import { describe, expect, it, vi } from "vitest";
import { GUTENBERG_TEXT_MIRROR, NovelSourceService, normalizeGutenbergText, normalizeWikisourceHtml } from "./novel-source.service.js";

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    title: "Alice's Adventures in Wonderland",
    authors: [{ name: "Lewis Carroll", death_year: 1898 }],
    translators: [],
    languages: ["en"],
    subjects: ["Fantasy"],
    bookshelves: ["Children's Literature"],
    copyright: false,
    formats: { "text/plain; charset=utf-8": "https://www.gutenberg.org/files/11/11-0.txt" },
    ...overrides,
  };
}

function jsonResponse(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function sourceText(first = 70_000, second = 70_000): string {
  return `*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\nFront matter\nCHAPTER I. First\n${"a".repeat(first)}\nCHAPTER II. Second\n${"b".repeat(second)}\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***`;
}

describe("novel source service", () => {
  it("queries one English catalog page and keeps books regardless of copyright or missing contributor dates", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo) => jsonResponse({
      next: "https://gutendex.com/books?page=2",
      results: [record(), record({ id: 12, authors: [{ name: "Author with unknown death", death_year: null }] }),
        record({ id: 13, translators: [{ name: "Recent translator", death_year: 1970 }] }), record({ id: 14, copyright: true })],
    }));
    const service = new NovelSourceService({ request: fetcher as unknown as (url: URL, init: RequestInit) => Promise<Response> });

    const result = await service.search({ query: "Alice Carroll", topic: "fantasy", page: 1 });

    expect(result.results).toHaveLength(4);
    expect(result.results[0]).toMatchObject({ sourceId: "11", title: "Alice's Adventures in Wonderland", language: "en" });
    expect(result.results[1]).toMatchObject({ sourceId: "12", authors: [{ name: "Author with unknown death", deathYear: null }] });
    expect(result.results[2]).toMatchObject({ sourceId: "13", translators: [{ name: "Recent translator", deathYear: 1970 }] });
    expect(result.results[3]?.sourceId).toBe("14");
    expect(result.hasNextPage).toBe(true);
    const calledUrl = new URL(String(fetcher.mock.calls[0]![0]));
    expect(calledUrl.pathname).toBe("/books/");
    expect(calledUrl.searchParams.has("copyright")).toBe(false);
    expect(calledUrl.searchParams.get("languages")).toBe("en");
    expect(calledUrl.searchParams.get("topic")).toBe("fantasy");
  });

  it("lists Korean works from the Wikisource novel category and searches only work pages", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.searchParams.get("cmtype") === "subcat") return jsonResponse({ query: { categorymembers: [{ pageid: 901, title: "분류:한국의 고전 소설" }] } });
      if (url.searchParams.get("list") === "categorymembers") {
        if (url.searchParams.get("cmtitle") === "분류:한국의 소설") return jsonResponse({ query: { categorymembers: [{ pageid: 101, title: "운수 좋은 날" }] } });
        if (url.searchParams.has("cmcontinue")) return jsonResponse({ query: { categorymembers: [{ pageid: 103, title: "다음 고전 작품" }] } });
        return jsonResponse({ query: { categorymembers: [{ pageid: 101, title: "운수 좋은 날" }, { pageid: 102, title: "고전 작품" }] }, continue: { cmcontinue: "page|다음 작품", continue: "||" } });
      }
      if (url.searchParams.has("prop")) return jsonResponse({ query: { pages: [
        { pageid: 101, revisions: [{ slots: { main: { content: "{{머리말|저자=[[현진건|현진건]]}}" } } }] },
      ] } });
      return jsonResponse({ query: { search: [{ pageid: 202, title: "김유정/동백꽃" }] }, continue: { sroffset: 32, continue: "||" } });
    });
    const service = new NovelSourceService({ request: fetcher as unknown as (url: URL, init: RequestInit) => Promise<Response> });

    const catalog = await service.search({ query: "", language: "ko" });
    expect(catalog).toMatchObject({ provider: "ko-wikisource", page: 1, hasNextPage: true, nextPageToken: expect.any(String) });
    expect(catalog.results[0]).toMatchObject({ provider: "ko-wikisource", sourceId: "101", title: "운수 좋은 날", language: "ko", authors: [{ name: "현진건", deathYear: null }] });
    expect(catalog.results[1]).toMatchObject({ sourceId: "102", title: "고전 작품" });
    expect(catalog.results[0]).not.toHaveProperty("rightsEvidence");
    expect(catalog.results[0]?.sourceUrl).toBe("https://ko.wikisource.org/wiki/%EC%9A%B4%EC%88%98_%EC%A2%8B%EC%9D%80_%EB%82%A0");
    const categoryUrl = new URL(String(fetcher.mock.calls[0]![0]));
    expect(categoryUrl.searchParams.get("cmtitle")).toBe("분류:한국의 소설");
    expect(categoryUrl.searchParams.get("cmtype")).toBe("subcat");
    expect(new URL(String(fetcher.mock.calls[1]![0])).searchParams.get("cmtitle")).toBe("분류:한국의 소설");
    expect(new URL(String(fetcher.mock.calls[2]![0])).searchParams.get("cmtitle")).toBe("분류:한국의 고전 소설");
    expect(new URL(String(fetcher.mock.calls[2]![0])).searchParams.get("cmlimit")).toBe("31");
    const next = await service.search({ query: "", language: "ko", page: 2, pageToken: catalog.nextPageToken });
    expect(next).toMatchObject({ hasNextPage: false, results: [{ sourceId: "103", title: "다음 고전 작품" }] });
    const nextUrl = new URL(String(fetcher.mock.calls[5]![0]));
    expect(nextUrl.searchParams.get("cmtitle")).toBe("분류:한국의 고전 소설");
    expect(nextUrl.searchParams.get("cmcontinue")).toBe("page|다음 작품");

    const search = await service.search({ query: "김유정", language: "ko", page: 2 });
    expect(search.results[0]).toMatchObject({ sourceId: "202", title: "김유정/동백꽃" });
    const searchUrl = new URL(String(fetcher.mock.calls[7]![0]));
    expect(searchUrl.searchParams.get("srnamespace")).toBe("0");
    expect(searchUrl.searchParams.get("srsearch")).toBe("incategory:한국의_소설 김유정");
    expect(searchUrl.searchParams.get("sroffset")).toBe("32");
  });

  it("imports a selected Wikisource page, strips markup, and supports Korean chapter ranges", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo) => jsonResponse({ parse: {
      pageid: 101, title: "운수 좋은 날", wikitext: "{{머리말|저자=[[현진건|현진건]]}}", text: `<style>.wst-header{border:1px solid red}</style><div class="wst-header ws-noexport">저자 미상 CSS header</div><div class="mw-parser-output"><p>앞머리 &amp; 설명</p><div class="sistersitebox">탐색 상자</div><h2><span class="mw-headline">제1장</span><span class="mw-editsection">[편집]</span></h2><p>${"가".repeat(70_000)}<sup class="reference">[1]</sup></p><h2>제2장</h2><p>${"나".repeat(70_000)}</p><h2><span class="mw-headline">라이선스</span></h2><p>퍼블릭 도메인이 아닐 수도 있습니다. 미국에서 퍼블릭 도메인인 저작물에는 {{PD-1996}}를 사용하십시오.</p></div>`,
    } }));
    const service = new NovelSourceService({ request: fetcher as unknown as (url: URL, init: RequestInit) => Promise<Response> });

    const inspection = await service.importWork({ provider: "ko-wikisource", sourceId: "101" });
    expect(inspection).toMatchObject({ book: { provider: "ko-wikisource", language: "ko", sourceId: "101", authors: [{ name: "현진건", deathYear: null }] }, needsChapterRange: true });
    expect(inspection.chapters.map(({ title }) => title)).toEqual(["제1장", "제2장"]);
    const selected = await service.importWork({ provider: "ko-wikisource", sourceId: "101", chapterRange: { firstChapter: 1, lastChapter: 1 } });
    expect(selected.sourceText).toMatch(/^제1장\n/);
    expect(selected.sourceText).not.toContain("[편집]");
    expect(selected.sourceText).not.toContain("[1]");
    expect(selected.sourceText).not.toContain("wst-header");
    expect(selected.sourceText).not.toContain("border:1px");
    expect(selected.sourceText).not.toContain("탐색 상자");
    expect(selected.sourceText).not.toContain("라이선스");
    expect(selected.sourceText).not.toContain("PD-1996");
    expect(selected.sourceText).toContain("가".repeat(70_000));
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.origin).toBe("https://ko.wikisource.org");
    expect(url.searchParams.get("action")).toBe("parse");
    expect(url.searchParams.get("pageid")).toBe("101");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("normalizes rendered Wikisource text without returning HTML", () => {
    expect(normalizeWikisourceHtml('<p>A&nbsp;&amp; B</p><br><h2>제1장</h2><p>본문</p>')).toBe("A & B\n\n제1장\n본문");
  });

  it("returns only normalized book text under 120,000 UTF-16 characters", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => String(input).includes("gutendex.com") ? jsonResponse(record()) : new Response(sourceText(10, 15)));
    const service = new NovelSourceService({ request: fetcher as unknown as (url: URL, init: RequestInit) => Promise<Response> });

    const result = await service.importWork({ sourceId: "11" });

    expect(result.sourceText).toContain("CHAPTER I. First");
    expect(result.sourceText).not.toContain("PROJECT GUTENBERG EBOOK");
    expect(result.selectedCharacterCount).toBe(result.sourceText!.length);
    expect(result.needsChapterRange).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://gutendex.com/books/11/");
    expect(String(fetcher.mock.calls[1]![0])).toBe(`${GUTENBERG_TEXT_MIRROR}/cache/epub/11/pg11.txt`);
  });

  it("imports a Gutenberg work even when its catalog or contributor metadata does not establish expired rights", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => String(input).includes("gutendex.com")
      ? jsonResponse(record({ copyright: true, authors: [{ name: "Author with unknown death", death_year: null }] }))
      : new Response(sourceText(10, 15)));
    const service = new NovelSourceService({ request: fetcher as unknown as (url: URL, init: RequestInit) => Promise<Response> });

    await expect(service.importWork({ provider: "project-gutenberg", sourceId: "11" })).resolves.toMatchObject({
      book: { sourceId: "11", authors: [{ name: "Author with unknown death", deathYear: null }] },
      sourceText: expect.stringContaining("CHAPTER I. First"),
    });
  });

  it("excludes repeated contents headings and includes letters in selectable chapter ranges", async () => {
    const text = `*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\nTitle\nCONTENTS\n Letter 1\n Letter 2\n Chapter 1\n Chapter 2\n\n\nLetter 1\n${"a".repeat(31_000)}\nLetter 2\n${"b".repeat(31_000)}\nChapter 1\n${"c".repeat(31_000)}\nChapter 2\n${"d".repeat(31_000)}\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***`;
    const fetcher = vi.fn(async (input: URL | RequestInfo) => String(input).includes("gutendex.com") ? jsonResponse(record()) : new Response(text));
    const service = new NovelSourceService({ request: fetcher as unknown as (url: URL, init: RequestInit) => Promise<Response> });

    const inspection = await service.importWork({ sourceId: "11" });
    expect(inspection.needsChapterRange).toBe(true);
    expect(inspection.chapters.map(({ title }) => title)).toEqual(["Letter 1", "Letter 2", "Chapter 1", "Chapter 2"]);
    expect(inspection.chapters.every(({ characterCount }) => characterCount > 30_000)).toBe(true);

    const selected = await service.importWork({ sourceId: "11", chapterRange: { firstChapter: 1, lastChapter: 1 } });
    expect(selected.sourceText).toMatch(/^Letter 1\n/);
    expect(selected.sourceText).not.toContain("CONTENTS");
  });

  it("requires a contiguous chapter range over the source cap and rejects a range that is still too long", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => String(input).includes("gutendex.com") ? jsonResponse(record()) : new Response(sourceText()));
    const service = new NovelSourceService({ request: fetcher as unknown as (url: URL, init: RequestInit) => Promise<Response> });
    const inspection = await service.importWork({ sourceId: "11" });
    expect(inspection).toMatchObject({ needsChapterRange: true, fullSourceCharacterCount: expect.any(Number), chapters: [{ number: 1 }, { number: 2 }] });
    expect(inspection.sourceText).toBeUndefined();

    const accepted = await service.importWork({ sourceId: "11", chapterRange: { firstChapter: 1, lastChapter: 1 } });
    expect(accepted.needsChapterRange).toBe(false);
    expect(accepted.selectedChapterRange).toEqual({ firstChapter: 1, lastChapter: 1 });
    expect(accepted.selectedCharacterCount).toBeLessThanOrEqual(120_000);
    expect(accepted.sourceText!.length).toBe(accepted.selectedCharacterCount);

    const rejected = await service.importWork({ sourceId: "11", chapterRange: { firstChapter: 1, lastChapter: 2 } });
    expect(rejected).toMatchObject({ selectionTooLong: true, selectedCharacterCount: expect.any(Number) });
    expect(rejected.sourceText).toBeUndefined();
  });

  it("rejects arbitrary IDs, malformed search fields and invalid body markers before analysis", async () => {
    const fetcher = vi.fn();
    const service = new NovelSourceService({ request: fetcher as unknown as (url: URL, init: RequestInit) => Promise<Response> });
    await expect(service.search({ query: "", topic: "" })).rejects.toMatchObject({ status: 400 });
    await expect(service.search({ query: "x", url: "https://attacker.test" })).rejects.toMatchObject({ status: 400 });
    await expect(service.importWork({ sourceId: "../11" })).rejects.toMatchObject({ status: 400 });
    expect(() => normalizeGutenbergText("plain text without source markers")).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
