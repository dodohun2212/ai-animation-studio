import { describe, expect, it } from "vitest";
import { isNovelSourceContributorExpired, isNovelSourceImportResponse, isNovelSourceSearchResponse, isNovelStorySourceCitation, novelSourceDeathYearCutoff } from "./novel-source.js";

const book = {
  provider: "project-gutenberg", sourceId: "11", title: "Alice's Adventures in Wonderland",
  authors: [{ name: "Lewis Carroll", deathYear: 1898 }], translators: [], language: "en", subjects: ["Fantasy"],
  sourceUrl: "https://www.gutenberg.org/ebooks/11", rightsEvidence: "Project Gutenberg US copyright status plus Korean term filter.",
};

describe("novel source contracts", () => {
  it("accepts catalog entries without treating contributor dates as an import gate", () => {
    expect(isNovelSourceSearchResponse({ provider: "project-gutenberg", page: 1, hasNextPage: false, results: [book] })).toBe(true);
    expect(isNovelSourceSearchResponse({ provider: "project-gutenberg", page: 1, hasNextPage: false, results: [{ ...book, authors: [{ name: "Unknown", deathYear: null }], rightsEvidence: undefined }] })).toBe(true);
    expect(isNovelSourceSearchResponse({ provider: "project-gutenberg", page: 1, hasNextPage: false, results: [{ ...book, sourceUrl: "https://elsewhere.test/11" }] })).toBe(false);
  });

  it("accepts Korean Wikisource pages without author or rights metadata, but validates their source URL", () => {
    const wikisourceBook = { provider: "ko-wikisource", sourceId: "1234", title: "운수 좋은 날", authors: [], translators: [], language: "ko", subjects: [], sourceUrl: "https://ko.wikisource.org/wiki/%EC%9A%B4%EC%88%98_%EC%A2%8B%EC%9D%80_%EB%82%A0" };
    expect(isNovelSourceSearchResponse({ provider: "ko-wikisource", page: 1, hasNextPage: false, results: [wikisourceBook] })).toBe(true);
    expect(isNovelSourceSearchResponse({ provider: "ko-wikisource", page: 1, hasNextPage: false, results: [{ ...wikisourceBook, sourceUrl: "https://elsewhere.test/1234" }] })).toBe(false);
  });

  it("requires imported text length to match the measured UTF-16 count", () => {
    const response = { book, fullSourceCharacterCount: 5, chapters: [], needsChapterRange: false, selectedCharacterCount: 5, sourceText: "abcde" };
    expect(isNovelSourceImportResponse(response)).toBe(true);
    expect(isNovelSourceImportResponse({ ...response, selectedCharacterCount: 4 })).toBe(false);
    expect(isNovelSourceImportResponse({ ...response, needsChapterRange: true, selectedCharacterCount: undefined, sourceText: undefined })).toBe(true);
  });

  it("uses the life-plus-70 cutoff conservatively for every named contributor", () => {
    expect(novelSourceDeathYearCutoff(2026)).toBe(1955);
    expect(isNovelSourceContributorExpired(1955, 2026)).toBe(true);
    expect(isNovelSourceContributorExpired(1956, 2026)).toBe(false);
    expect(isNovelSourceContributorExpired(1955, 2027)).toBe(true);
  });

  it("accepts citation metadata without the catalog-only subjects field", () => {
    expect(isNovelStorySourceCitation({ ...book, fullSourceCharacterCount: 5, selectedCharacterCount: 5 })).toBe(true);
    expect(isNovelStorySourceCitation({ provider: "ko-wikisource", sourceId: "1234", title: "운수 좋은 날", authors: [], translators: [], language: "ko", sourceUrl: "https://ko.wikisource.org/wiki/%EC%9A%B4%EC%88%98_%EC%A2%8B%EC%9D%80_%EB%82%A0", fullSourceCharacterCount: 5, selectedCharacterCount: 5 })).toBe(true);
  });
});
