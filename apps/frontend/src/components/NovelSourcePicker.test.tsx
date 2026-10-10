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
/** 위키문헌 항목 — 작가·사망 연도·권리 정보가 없을 수 있다(CLI 1363). */
const KIM: NovelSourceBook = {
  provider: "ko-wikisource",
  sourceId: "12345",
  title: "운수 좋은 날",
  authors: [],
  translators: [],
  language: "ko",
  subjects: [],
  sourceUrl: "https://ko.wikisource.org/wiki/%EC%9A%B4%EC%88%98_%EC%A2%8B%EC%9D%80_%EB%82%A0",
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

  /**
   * 🔴 검색은 누를 때만(열 때·언어를 바꿀 때의 기본 목록 제외), 목록만 — 본문은 받지 않는다. 범위·한계는 늘 보인다.
   * CLI 1351·1363: 열자마자 한국어(위키문헌) 후보, 영어로 바꾸면 Gutenberg 「fiction」 후보. 장르는 영어에서만.
   */
  it("lists Korean novels on open, lists English fiction on switching, then searches only when asked", async () => {
    const fetchMock = mockServer({ [SEARCH]: { provider: "project-gutenberg", results: [POE], page: 1, hasNextPage: false } });
    renderPicker();
    expect(screen.getByTestId("novel-source-scope").textContent).toContain("저작권이 끝났는지 거르지 않습니다");
    expect(screen.getByTestId("novel-source-language-ko").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("novel-source-topic")).toBeNull();
    await screen.findByTestId("novel-source-book-2147");
    expect(posts(fetchMock)).toEqual([{ url: "/story-sources/search", body: { query: "", language: "ko" } }]);

    fireEvent.click(screen.getByTestId("novel-source-language-en"));
    expect((screen.getByTestId("novel-source-topic") as HTMLSelectElement).value).toBe("fiction");
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2));
    await screen.findByTestId("novel-source-book-2147");
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "  poe " } });
    fireEvent.change(screen.getByTestId("novel-source-topic"), { target: { value: "horror" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    const card = await screen.findByTestId("novel-source-book-2147");
    expect(card.textContent).toContain("Poe, Edgar Allan (~1849)");
    expect(card.textContent).toContain("Project Gutenberg");
    expect(card.querySelector("a")!.getAttribute("href")).toBe("https://www.gutenberg.org/ebooks/2147");
    expect(card.querySelector("a")!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(posts(fetchMock)).toEqual([
      { url: "/story-sources/search", body: { query: "", language: "ko" } },
      { url: "/story-sources/search", body: { query: "", language: "en", topic: "fiction" } },
      { url: "/story-sources/search", body: { query: "poe", language: "en", topic: "horror" } },
    ]);
  });

  /** CLI 1363: 위키문헌 분류 목록은 이어보기 토큰으로 넘긴다 — 다음 쪽은 받은 토큰을, 첫 쪽으로 돌아가면 토큰 없이. */
  it("pages the Korean category list with the server's continuation token, and says when nothing matched", async () => {
    const fetchMock = mockServer({ [SEARCH]: sequence([
      { provider: "ko-wikisource", results: [KIM], page: 1, hasNextPage: true, nextPageToken: "page|tok2" },
      { provider: "ko-wikisource", results: [], page: 2, hasNextPage: false },
      { provider: "ko-wikisource", results: [KIM], page: 1, hasNextPage: true, nextPageToken: "page|tok2" },
    ]) });
    renderPicker();
    await screen.findByTestId("novel-source-book-12345");
    fireEvent.click(screen.getByTestId("novel-source-next"));
    await screen.findByTestId("novel-source-empty");
    expect(posts(fetchMock)[1]!.body).toEqual({ query: "", language: "ko", page: 2, pageToken: "page|tok2" });
    fireEvent.click(screen.getByTestId("novel-source-prev"));
    await screen.findByTestId("novel-source-book-12345");
    expect(posts(fetchMock)[2]!.body).toEqual({ query: "", language: "ko" });
  });

  /** 영어는 검색어나 장르 중 하나가 있어야 — 장르 「전체」+ 빈 검색어는 검색이 꺼지고 Enter 도 보내지 않는다. 한국어는 빈 검색어도 분류 목록. */
  it("needs a query or a genre in English, but lets an empty Korean search list the category", async () => {
    const fetchMock = mockServer({ [SEARCH]: { provider: "project-gutenberg", results: [POE], page: 1, hasNextPage: false } });
    renderPicker();
    await screen.findByTestId("novel-source-book-2147");
    expect((screen.getByTestId("novel-source-search") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("novel-source-language-en"));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText(/목록을 찾는 중/)).toBeNull());
    fireEvent.change(screen.getByTestId("novel-source-topic"), { target: { value: "" } });
    expect((screen.getByTestId("novel-source-search") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByTestId("novel-source-query"), { key: "Enter" });
    expect(posts(fetchMock)).toHaveLength(2);
  });

  /** CLI 1363: 위키문헌 작품 — 작가 정보가 없어도 고를 수 있고, 가져올 때 제공처를 함께 보낸다. 권리 판단 줄은 그리지 않는다. */
  it("imports a Wikisource work with its provider and shows where it came from", async () => {
    const fetchMock = mockServer({
      [SEARCH]: { provider: "ko-wikisource", results: [KIM], page: 1, hasNextPage: false },
      [IMPORT]: { book: KIM, fullSourceCharacterCount: 10, chapters: [], needsChapterRange: false, selectedCharacterCount: 10, sourceText: "새침하게 흐린 품이" },
    });
    const { onPick } = renderPicker();
    const card = await screen.findByTestId("novel-source-book-12345");
    expect(card.textContent).toContain("작가 정보 없음");
    expect(card.textContent).toContain("위키문헌");
    expect(card.querySelector("a")!.getAttribute("href")).toContain("https://ko.wikisource.org/wiki/");
    fireEvent.click(screen.getByTestId("novel-source-check-12345"));
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0]![0].citation).toMatchObject({ provider: "ko-wikisource", sourceId: "12345", language: "ko" });
    expect(screen.queryByTestId("novel-source-rights")).toBeNull();
    expect(posts(fetchMock).find((call) => call.url === "/story-sources/import")!.body).toEqual({ provider: "ko-wikisource", sourceId: "12345" });
  });

  /** CLI 1349: 본문 칸에 글이 있으면 덮지 않는다 — 「지금 본문을 바꿉니다」를 눌러야 들어가고, 넣은 뒤에는 다시 묻지 않는다. */
  it("does not overwrite existing text on its own, and hands the work over only when the person replaces it", async () => {
    const fetchMock = mockServer({
      [SEARCH]: { provider: "project-gutenberg", results: [POE], page: 1, hasNextPage: false },
      [IMPORT]: { book: POE, fullSourceCharacterCount: 12, chapters: [{ number: 1, title: "The Raven", characterCount: 12 }], needsChapterRange: false, selectedCharacterCount: 12, sourceText: "Once upon a." },
    });
    const { onPick } = renderPicker(true);
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "poe" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    fireEvent.click(await screen.findByTestId("novel-source-check-2147"));
    expect((await screen.findByTestId("novel-source-length")).textContent).toContain("전체 12자 · 장 1개");
    expect(screen.getByTestId("novel-source-rights").textContent).toContain("제공처 정보: 저자 사망 1849년");
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByTestId("novel-source-ready").textContent).toContain("아직 넣지 않았습니다");
    expect(screen.getByTestId("novel-source-use").textContent).toContain("지금 본문을 바꿉니다");
    fireEvent.click(screen.getByTestId("novel-source-use"));
    expect(screen.getByTestId("novel-source-ready").textContent).toContain("본문 칸에 넣었습니다");
    expect(screen.queryByTestId("novel-source-use")).toBeNull();
    expect(onPick).toHaveBeenCalledWith({ text: "Once upon a.", citation: expect.objectContaining({ sourceId: "2147", fullSourceCharacterCount: 12, selectedCharacterCount: 12 }) });
    expect(onPick.mock.calls[0]![0].citation.chapterRange).toBeUndefined();
    expect(posts(fetchMock).find((call) => call.url === "/story-sources/import")!.body).toEqual({ provider: "project-gutenberg", sourceId: "2147" });
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
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("novel-source-import-range"));
    // CLI 1349: 범위 가져오기가 성공하면 곧바로 본문 칸으로 — 「쓰기」를 한 번 더 누르지 않는다.
    expect((await screen.findByTestId("novel-source-ready")).textContent).toContain("2–2장 · 7자 — 아래 이야기 본문 칸에 넣었습니다");
    expect(screen.queryByTestId("novel-source-use")).toBeNull();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0].citation.chapterRange).toEqual({ firstChapter: 2, lastChapter: 2 });
    expect(posts(fetchMock).filter((call) => call.url === "/story-sources/import").map((call) => call.body)).toEqual([
      { provider: "project-gutenberg", sourceId: "84" },
      { provider: "project-gutenberg", sourceId: "84", chapterRange: { firstChapter: 2, lastChapter: 2 } },
    ]);
  });

  /** CLI 1349: 한도 안의 작품은 「이 작품 가져오기」 한 번으로 본문 칸까지 — 고르지 않은 후보의 본문은 받지 않는다. */
  it("fills an empty story from one press on a work within the limit", async () => {
    const fetchMock = mockServer({
      [SEARCH]: { provider: "project-gutenberg", results: [POE, LONG], page: 1, hasNextPage: false },
      [IMPORT]: { book: POE, fullSourceCharacterCount: 12, chapters: [], needsChapterRange: false, selectedCharacterCount: 12, sourceText: "Once upon a." },
    });
    const { onPick } = renderPicker(false);
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "poe" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    expect((await screen.findByTestId("novel-source-check-2147")).textContent).toBe("이 작품 가져오기");
    fireEvent.click(screen.getByTestId("novel-source-check-2147"));
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0]![0]).toEqual({ text: "Once upon a.", citation: expect.objectContaining({ sourceId: "2147", selectedCharacterCount: 12 }) });
    expect(screen.getByTestId("novel-source-ready").textContent).toContain("본문 칸에 넣었습니다");
    expect(screen.getByTestId("novel-source-length").textContent).toContain("장 구분 없음");
    expect(screen.queryByTestId("novel-source-use")).toBeNull();
    expect(posts(fetchMock).filter((call) => call.url === "/story-sources/import").map((call) => call.body)).toEqual([{ provider: "project-gutenberg", sourceId: "2147" }]);
  });

  /** CLI 1351: 가져오는 동안 사람이 본문 칸에 글을 쓰면, 늦게 온 응답이 그 글을 덮지 않는다(응답 시점의 칸 상태로 판단). */
  it("does not overwrite text typed while the work was still loading", async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/story-sources/search") return new Response(JSON.stringify({ provider: "project-gutenberg", results: [POE], page: 1, hasNextPage: false }), { status: 201 });
      return new Promise<Response>((resolve) => { release = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onPick = vi.fn();
    const { rerender } = render(<NovelSourcePicker onPick={onPick} hasText={false} />);
    fireEvent.click(await screen.findByTestId("novel-source-check-2147"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    rerender(<NovelSourcePicker onPick={onPick} hasText />);
    release(new Response(JSON.stringify({ book: POE, fullSourceCharacterCount: 12, chapters: [], needsChapterRange: false, selectedCharacterCount: 12, sourceText: "Once upon a." }), { status: 201 }));
    expect((await screen.findByTestId("novel-source-ready")).textContent).toContain("아직 넣지 않았습니다");
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByTestId("novel-source-use")).toBeTruthy();
  });

  it("keeps searching possible when the opening list fails", async () => {
    const fetchMock = mockServer({}, { [SEARCH]: { status: 503, body: { code: "NOVEL_SOURCE_UNAVAILABLE", message: "raw" } } });
    renderPicker();
    expect((await screen.findByTestId("novel-source-search-error")).getAttribute("data-error-code")).toBe("NOVEL_SOURCE_UNAVAILABLE");
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "poe" } });
    expect((screen.getByTestId("novel-source-search") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("novel-source-search"));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2));
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
    expect(screen.getByTestId("novel-source-length").textContent).toContain("장 구분 없음");
  });

  it("shows a fixed sentence for each source error and never the server's text", async () => {
    mockServer(
      { [SEARCH]: { provider: "project-gutenberg", results: [POE], page: 1, hasNextPage: false } },
      { [IMPORT]: { status: 404, body: { code: "NOVEL_SOURCE_NOT_FOUND", message: "raw" } } },
    );
    renderPicker();
    fireEvent.change(screen.getByTestId("novel-source-query"), { target: { value: "poe" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    fireEvent.click(await screen.findByTestId("novel-source-check-2147"));
    const alert = await screen.findByTestId("novel-source-import-error");
    expect(alert.getAttribute("data-error-code")).toBe("NOVEL_SOURCE_NOT_FOUND");
    expect(alert.textContent).toContain("찾지 못했습니다");
    expect(alert.textContent).not.toContain("raw");
  });

  it("explains an unreachable catalogue on search", async () => {
    mockServer({}, { [SEARCH]: { status: 503, body: { code: "NOVEL_SOURCE_UNAVAILABLE", message: "raw" } } });
    renderPicker();
    await screen.findByTestId("novel-source-search-error");
    fireEvent.click(screen.getByTestId("novel-source-language-en"));
    await waitFor(() => expect(screen.queryByText(/목록을 찾는 중/)).toBeNull());
    fireEvent.change(screen.getByTestId("novel-source-topic"), { target: { value: "fantasy" } });
    fireEvent.click(screen.getByTestId("novel-source-search"));
    await waitFor(() => expect(screen.getByTestId("novel-source-search-error").getAttribute("data-error-code")).toBe("NOVEL_SOURCE_UNAVAILABLE"));
    expect(screen.getByTestId("novel-source-search-error").textContent).toContain("다시 누르면");
    expect(screen.getByTestId("novel-source-search-error").textContent).not.toContain("raw");
  });
});
