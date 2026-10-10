import { describe, expect, it, vi } from "vitest";
import { GUTENBERG_TEXT_MIRROR, NovelSourceService, normalizeGutenbergText } from "./novel-source.service.js";

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
  it("queries one English catalog page and drops books without Korean-expired named contributors", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo) => jsonResponse({
      next: "https://gutendex.com/books?page=2",
      results: [record(), record({ id: 12, authors: [{ name: "Author with unknown death", death_year: null }] }),
        record({ id: 13, translators: [{ name: "Recent translator", death_year: 1970 }] }), record({ id: 14, copyright: true })],
    }));
    const service = new NovelSourceService({ request: fetcher as unknown as (url: URL, init: RequestInit) => Promise<Response> });

    const result = await service.search({ query: "Alice Carroll", topic: "fantasy", page: 1 });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ sourceId: "11", title: "Alice's Adventures in Wonderland", language: "en" });
    expect(result.hasNextPage).toBe(true);
    const calledUrl = new URL(String(fetcher.mock.calls[0]![0]));
    expect(calledUrl.pathname).toBe("/books/");
    expect(calledUrl.searchParams.get("copyright")).toBe("false");
    expect(calledUrl.searchParams.get("languages")).toBe("en");
    expect(calledUrl.searchParams.get("topic")).toBe("fantasy");
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
