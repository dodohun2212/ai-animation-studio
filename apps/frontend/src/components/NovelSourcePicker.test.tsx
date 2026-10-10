import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NovelSourceBook, NovelSourceImportResponse } from "@ai-animation-studio/shared";
import { sequence, stubFetchByRoute } from "../api/testUtils.js";
import { NovelSourcePicker, chapterRangeCharacterCount, citationFor } from "./NovelSourcePicker.js";

export const POE: NovelSourceBook = {
  provider: "project-gutenberg",
  sourceId: "2147",
  title: "The Works of Edgar Allan Poe — Volume 1",
  authors: [{ name: "Poe, Edgar Allan", deathYear: 1849 }],
  translators: [],
  language: "en",
  subjects: ["Fantasy fiction", "Horror tales", "Short stories"],
  sourceUrl: "https://www.gutenberg.org/ebooks/2147",
  rightsEvidence: "저자 사망 1849년 — 한국 보호기간(사후 70년) 경과",
};
const LONG: NovelSourceBook = { ...POE, sourceId: "84", title: "Frankenstein", authors: [{ name: "Shelley, Mary", deathYear: 1851 }], sourceUrl: "https://www.gutenberg.org/ebooks/84" };

const SEARCH = "POST /story-sources/search";
const IMPORT = "POST /story-sources/import";

const CHAPTERS = [
  { number: 1, title: "Letter 1", characterCount: 50_000 },
  { number: 2, title: "Chapter 1", characterCount: 60_000 },
  { number: 3, title: "Chapter 2", characterCount: 70_000 },
];
const needsRange: NovelSourceImportResponse = { book: LONG, fullSourceCharacterCount: 180_000, chapters: CHAPTERS, needsChapterRange: true };

function mockServer(routes: Record<string, unknown>, errors: Record<string, { status: number; body: unknown }> = {}) {
  const fetchMock = stubFetchByRoute(routes, errors);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const posts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) }));

function renderPicker(hasText = false) {
  const onPick = vi.fn();
  render(<NovelSourcePicker onPick={onPick} hasText={hasText} />);
  return { onPick };
}

describe("NovelSourcePicker helpers", () => {
  it("adds up a chosen chapter range and builds a citation without the text", () => {
    expect(chapterRangeCharacterCount(CHAPTERS, { firstChapter: 2, lastChapter: 3 })).toBe(130_000);
    const citation = citationFor(LONG, { ...needsRange, needsChapterRange: false, selectedChapterRange: { firstChapter: 1, lastChapter: 2 }, selectedCharacterCount: 5, sourceText: "abcde" });
    expect(citation).toMatchObject({ sourceId: "84", fullSourceCharacterCount: 180_000, selectedCharacterCount: 5, chapterRange: { firstChapter: 1, lastChapter: 2 } });
    expect("sourceText" in citation).toBe(false);
  });
});

describe("NovelSourcePicker", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** 🔴 검색은 누를 때만, 목록만 — 본문은 받지 않는다. 범위·한계는 늘 보인다. */
  it("searches only when asked, sends the genre as an English topic, and fetches no text for the list", async () => {
    const fetchMock = mockServer({ [SEARCH]: { provider: "project-gutenberg", results: [POE], page: 1, hasNextPage: false } });
    renderPicker();
    expect(screen.getByTestId("novel-source-scope").textContent).toContain("법적 보증이 아니니");
    expect(screen.getByTestId("novel-source-scope").textContent).toContain("1955년까지 세상을 떠난");
    expect((screen.getByTestId("novel-source-search") as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "  poe " } });
    fireEvent.change(screen.getByTestId("novel-source-topic"), { target: { value: "horror" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    const card = await screen.findByTestId("novel-source-book-2147");
    expect(card.textContent).toContain("Poe, Edgar Allan (~1849)");
    expect(card.querySelector("a")!.getAttribute("href")).toBe("https://www.gutenberg.org/ebooks/2147");
    expect(card.querySelector("a")!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(posts(fetchMock)).toEqual([{ url: "/story-sources/search", body: { query: "poe", topic: "horror" } }]);
  });

  it("pages with the server's page number and says when nothing matched", async () => {
    const fetchMock = mockServer({ [SEARCH]: sequence([
      { provider: "project-gutenberg", results: [POE], page: 1, hasNextPage: true },
      { provider: "project-gutenberg", results: [], page: 2, hasNextPage: false },
    ]) });
    renderPicker();
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "poe" } });
    fireEvent.keyDown(screen.getByTestId("novel-source-query"), { key: "Enter" });
    await screen.findByTestId("novel-source-book-2147");
    fireEvent.click(screen.getByTestId("novel-source-next"));
    await screen.findByTestId("novel-source-empty");
    expect(posts(fetchMock)[1]!.body).toEqual({ query: "poe", page: 2 });
  });

  /** 한도 안의 작품 — 길이를 확인하면 바로 쓸 수 있고, 「이 본문 쓰기」를 눌러야 칸에 들어간다. */
  it("checks one work's length on request and hands over the text only when the person uses it", async () => {
    const fetchMock = mockServer({
      [SEARCH]: { provider: "project-gutenberg", results: [POE], page: 1, hasNextPage: false },
      [IMPORT]: { book: POE, fullSourceCharacterCount: 12, chapters: [{ number: 1, title: "The Raven", characterCount: 12 }], needsChapterRange: false, selectedCharacterCount: 12, sourceText: "Once upon a." },
    });
    const { onPick } = renderPicker(true);
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "poe" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    fireEvent.click(await screen.findByTestId("novel-source-check-2147"));
    expect((await screen.findByTestId("novel-source-length")).textContent).toContain("전체 12자 · 장 1개");
    expect(screen.getByTestId("novel-source-rights").textContent).toContain("사후 70년");
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByTestId("novel-source-use").textContent).toContain("지금 본문을 바꿉니다");
    fireEvent.click(screen.getByTestId("novel-source-use"));
    expect(onPick).toHaveBeenCalledWith({ text: "Once upon a.", citation: expect.objectContaining({ sourceId: "2147", fullSourceCharacterCount: 12, selectedCharacterCount: 12 }) });
    expect(onPick.mock.calls[0]![0].citation.chapterRange).toBeUndefined();
    expect(posts(fetchMock).find((call) => call.url === "/story-sources/import")!.body).toEqual({ sourceId: "2147" });
  });

  /** 1344-(a): 한도를 넘으면 장 목록과 장별 글자 수를 보여 주고, 이어진 범위를 골라 다시 가져온다. 넘는 범위는 보내지 않는다. */
  it("asks for a continuous chapter range when the work is too long, and refuses a range over the limit before sending", async () => {
    const ranged: NovelSourceImportResponse = { ...needsRange, needsChapterRange: false, selectedChapterRange: { firstChapter: 2, lastChapter: 2 }, selectedCharacterCount: 7, sourceText: "Chapter" };
    const fetchMock = mockServer({
      [SEARCH]: { provider: "project-gutenberg", results: [LONG], page: 1, hasNextPage: false },
      [IMPORT]: sequence([needsRange, ranged]),
    });
    const { onPick } = renderPicker();
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "frank" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    fireEvent.click(await screen.findByTestId("novel-source-check-84"));
    expect((await screen.findByTestId("novel-source-length")).textContent).toContain("이어진 장 범위를 골라야");
    expect(screen.queryByTestId("novel-source-use")).toBeNull();
    expect(screen.getByTestId("novel-source-chapter-3").textContent).toContain("70,000자");

    fireEvent.change(screen.getByTestId("novel-source-last"), { target: { value: "3" } });
    expect(screen.getByTestId("novel-source-range-count").textContent).toContain("1–3장 · 약 180,000자 — 분석 한도");
    expect((screen.getByTestId("novel-source-import-range") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("novel-source-first"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("novel-source-last"), { target: { value: "2" } });
    expect(screen.getByTestId("novel-source-range-count").textContent).toBe("2–2장 · 약 60,000자");
    fireEvent.click(screen.getByTestId("novel-source-import-range"));
    expect((await screen.findByTestId("novel-source-ready")).textContent).toContain("2–2장 · 7자");
    fireEvent.click(screen.getByTestId("novel-source-use"));
    expect(onPick.mock.calls[0]![0].citation.chapterRange).toEqual({ firstChapter: 2, lastChapter: 2 });
    expect(posts(fetchMock).filter((call) => call.url === "/story-sources/import").map((call) => call.body)).toEqual([
      { sourceId: "84" },
      { sourceId: "84", chapterRange: { firstChapter: 2, lastChapter: 2 } },
    ]);
  });

  it("says when the server measures the chosen range as still too long, and when no chapters were found", async () => {
    mockServer({
      [SEARCH]: { provider: "project-gutenberg", results: [LONG, POE], page: 1, hasNextPage: false },
      [IMPORT]: sequence([needsRange, { ...needsRange, needsChapterRange: false, selectedChapterRange: { firstChapter: 1, lastChapter: 1 }, selectedCharacterCount: 130_000, selectionTooLong: true }, { ...needsRange, book: POE, chapters: [] }]),
    });
    renderPicker();
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    fireEvent.click(await screen.findByTestId("novel-source-check-84"));
    await screen.findByTestId("novel-source-range");
    fireEvent.click(screen.getByTestId("novel-source-import-range"));
    expect((await screen.findByTestId("novel-source-range-too-long")).textContent).toContain("130,000자");
    expect(screen.queryByTestId("novel-source-use")).toBeNull();

    fireEvent.click(screen.getByTestId("novel-source-check-2147"));
    expect((await screen.findByTestId("novel-source-no-chapters")).textContent).toContain("장의 경계를 찾지 못해");
  });

  it("shows a fixed sentence for each source error and never the server's text", async () => {
    mockServer(
      { [SEARCH]: { provider: "project-gutenberg", results: [POE], page: 1, hasNextPage: false } },
      { [IMPORT]: { status: 404, body: { code: "NOVEL_SOURCE_NOT_ELIGIBLE", message: "raw" } } },
    );
    renderPicker();
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "poe" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    fireEvent.click(await screen.findByTestId("novel-source-check-2147"));
    const alert = await screen.findByTestId("novel-source-import-error");
    expect(alert.getAttribute("data-error-code")).toBe("NOVEL_SOURCE_NOT_ELIGIBLE");
    expect(alert.textContent).toContain("사망 연도");
    expect(alert.textContent).not.toContain("raw");
  });

  it("explains an unreachable catalogue on search", async () => {
    mockServer({}, { [SEARCH]: { status: 503, body: { code: "NOVEL_SOURCE_UNAVAILABLE", message: "raw" } } });
    renderPicker();
    fireEvent.change(screen.getByTestId("novel-source-topic"), { target: { value: "fantasy" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    await waitFor(() => expect(screen.getByTestId("novel-source-search-error").getAttribute("data-error-code")).toBe("NOVEL_SOURCE_UNAVAILABLE"));
    expect(screen.getByTestId("novel-source-search-error").textContent).toContain("인터넷 연결");
    expect(screen.getByTestId("novel-source-search-error").textContent).not.toContain("raw");
  });
});
