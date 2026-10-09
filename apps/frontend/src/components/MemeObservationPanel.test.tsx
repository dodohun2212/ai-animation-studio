import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemeTrend, MemeTrendWorkspace } from "@ai-animation-studio/shared";
import { jsonResponse } from "../api/testUtils.js";
import { MemeObservationPanel } from "./MemeObservationPanel.js";

const OBSERVED = "2026-10-07T15:00:00.000Z";
const SAVED_AT = "2026-10-07T16:00:00.000Z";

const TREND: MemeTrend = {
  id: "niko",
  name: "니코니코니",
  evidence: [{ kind: "hashtag", text: "#니코니코니", videoCount: 3 }],
  videos: [
    { videoId: "low", url: "https://www.youtube.com/watch?v=low", title: "적게 본 영상", channelId: "a", channelTitle: "채널 A", publishedAt: OBSERVED, thumbnailUrl: null, viewCount: 10, viewCountObservedAt: OBSERVED },
    { videoId: "top", url: "https://www.youtube.com/watch?v=top", title: "많이 본 영상", channelId: "b", channelTitle: "채널 B", publishedAt: OBSERVED, thumbnailUrl: null, viewCount: 9000, viewCountObservedAt: OBSERVED },
    { videoId: "hidden", url: "https://www.youtube.com/watch?v=hidden", title: "비공개 조회수", channelId: "b", channelTitle: "채널 B", publishedAt: OBSERVED, thumbnailUrl: null, viewCount: null, viewCountObservedAt: OBSERVED },
  ],
  channelCount: 2,
  firstObservedAt: OBSERVED,
  lastObservedAt: OBSERVED,
};

const ANALYSIS = {
  sourceVideoId: "top",
  provider: "gemini" as const,
  model: "gemini-test",
  analyzedAt: OBSERVED,
  suggestions: [
    { id: "s1", kind: "line" as const, text: "니코니코니~ 하고 외친다", startSeconds: 1, endSeconds: 2.5 },
    { id: "s2", kind: "gesture" as const, text: "양손으로 하트", startSeconds: null, endSeconds: null },
  ],
};

function workspace(overrides: Partial<MemeTrendWorkspace> = {}): MemeTrendWorkspace {
  return { trendId: "niko", analysis: null, cards: [], cardsSavedAt: null, dailyCalls: { used: 0, limit: 3 }, ...overrides };
}

type Answer = { status: number; body: unknown };
/** 경로별로 순서대로 답하는 가짜 서버. 요청 본문도 기록합니다. */
function backend(routes: Record<string, Answer[]>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const queue = routes[`${method} ${url}`];
    if (!queue || queue.length === 0) throw new Error(`Unexpected fetch: ${method} ${url}`);
    const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
    return jsonResponse(answer.status, answer.body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const GET = "GET /trends/memes/niko/workspace";
const ANALYZE = "POST /trends/memes/niko/analysis";
const PUT = "PUT /trends/memes/niko/cards";

function renderPanel() {
  const onOpenSettings = vi.fn();
  render(<MemeObservationPanel trend={TREND} onOpenSettings={onOpenSettings} onProjectCreated={() => {}} />);
  return { onOpenSettings };
}

describe("MemeObservationPanel", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("opens the remix plan only from saved cards and waits for changed cards to be saved", async () => {
    const card = { id: "saved-1", kind: "gesture" as const, text: "양손으로 하트", startSeconds: null, endSeconds: null,
      origin: "manual" as const, sourceVideoId: null };
    const calls = backend({ [GET]: [{ status: 200, body: workspace({ cards: [card], cardsSavedAt: SAVED_AT }) }] });
    renderPanel();
    const open = await screen.findByTestId("meme-remix-open");
    expect(open).not.toBeDisabled();
    fireEvent.change(screen.getByTestId("meme-card-text-0"), { target: { value: "새 동작" } });
    expect(open).toBeDisabled();
    expect(screen.getByText("먼저 바뀐 카드를 저장해 주세요.")).toBeTruthy();
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  /** 🔴 후보를 고르는 것으로는 Gemini 를 부르지 않습니다 — 저장본 읽기 한 번뿐. */
  it("only reads the saved workspace when opened, and defaults to the most-viewed video", async () => {
    const calls = backend({ [GET]: [{ status: 200, body: workspace() }] });
    renderPanel();

    expect((await screen.findByTestId("meme-analysis-calls")).textContent).toBe("오늘 0 / 3회");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([GET]);
    expect((screen.getByTestId("meme-analysis-video") as HTMLSelectElement).value).toBe("top");
    expect(screen.getByTestId("meme-cards-empty")).toBeTruthy();
  });

  it("analyses only the chosen video, once, and shows the result as read-only suggestions", async () => {
    const calls = backend({
      [GET]: [{ status: 200, body: workspace() }],
      [ANALYZE]: [{ status: 200, body: workspace({ analysis: ANALYSIS, dailyCalls: { used: 1, limit: 3 } }) }],
    });
    renderPanel();
    await screen.findByTestId("meme-analysis-calls");

    fireEvent.change(screen.getByTestId("meme-analysis-video"), { target: { value: "low" } });
    fireEvent.click(screen.getByTestId("meme-analysis-run"));

    await screen.findByTestId("meme-suggestions");
    expect(calls.filter((call) => call.method === "POST")).toEqual([{ method: "POST", url: "/trends/memes/niko/analysis", body: { sourceVideoId: "low" } }]);
    expect(screen.getByTestId("meme-suggestion-s1").textContent).toContain("0:01–0:02.5");
    expect(screen.getByTestId("meme-suggestions-source").textContent).toContain("「많이 본 영상」");
    expect(screen.getByTestId("meme-analysis-calls").textContent).toBe("오늘 1 / 3회");
    // 제안은 카드가 아닙니다 — 가져오기 전까지 카드는 비어 있습니다.
    expect(screen.getByTestId("meme-cards-empty")).toBeTruthy();
  });

  /** 🔴 분석이 실패해도 고치던 카드는 그대로 — 그리고 서버가 실어 보낸 새 횟수로 바뀝니다. */
  it("keeps unsaved cards and updates the count when an analysis fails", async () => {
    backend({
      [GET]: [{ status: 200, body: workspace() }],
      [ANALYZE]: [{ status: 502, body: { code: "MEME_ANALYSIS_FAILED", message: "raw", details: { dailyCalls: { used: 2, limit: 3 } } } }],
    });
    renderPanel();
    await screen.findByTestId("meme-analysis-calls");

    fireEvent.click(screen.getByTestId("meme-cards-add"));
    fireEvent.change(screen.getByTestId("meme-card-text-0"), { target: { value: "직접 적은 동작" } });
    fireEvent.click(screen.getByTestId("meme-analysis-run"));

    const alert = await screen.findByTestId("meme-analysis-error");
    expect(alert.getAttribute("data-error-code")).toBe("MEME_ANALYSIS_FAILED");
    expect(alert.textContent).not.toContain("raw");
    expect((screen.getByTestId("meme-card-text-0") as HTMLTextAreaElement).value).toBe("직접 적은 동작");
    expect(screen.getByTestId("meme-cards-unsaved")).toBeTruthy();
    expect(screen.getByTestId("meme-analysis-calls").textContent).toBe("오늘 2 / 3회");
  });

  it("offers API 설정 when the Gemini key is missing, and still lets a card be written by hand", async () => {
    backend({
      [GET]: [{ status: 200, body: workspace() }],
      [ANALYZE]: [{ status: 400, body: { code: "MEME_ANALYSIS_KEY_MISSING", message: "raw" } }],
    });
    const { onOpenSettings } = renderPanel();
    await screen.findByTestId("meme-analysis-calls");

    fireEvent.click(screen.getByTestId("meme-analysis-run"));
    expect((await screen.findByTestId("meme-analysis-error")).textContent).toContain("직접 적을 수 있습니다");
    fireEvent.click(screen.getByTestId("meme-analysis-open-settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("meme-cards-add"));
    expect(screen.getByTestId("meme-card-origin-0").textContent).toBe("직접 적음");
  });

  it("disables analysis when today's allowance is used up or the ledger cannot be read", async () => {
    backend({ [GET]: [{ status: 200, body: workspace({ dailyCalls: { used: 3, limit: 3 } }) }] });
    renderPanel();
    expect((await screen.findByTestId("meme-analysis-calls")).textContent).toContain("다 썼습니다");
    expect((screen.getByTestId("meme-analysis-run") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not offer analysis when the call count is unknown", async () => {
    backend({ [GET]: [{ status: 200, body: workspace({ dailyCalls: null }) }] });
    renderPanel();
    expect((await screen.findByTestId("meme-analysis-calls")).textContent).toContain("오늘 쓴 횟수를 모릅니다");
    expect((screen.getByTestId("meme-analysis-run") as HTMLButtonElement).disabled).toBe(true);
  });

  /** 가져온 카드는 출처를 말하고, 제안 원문에서 바뀌면 「고침」이 붙습니다(서버 플래그 없이 비교로). */
  it("imports a suggestion as a card, marks it once edited, and saves with the expected time", async () => {
    const savedCard = { id: "c1", kind: "line" as const, text: "니코니코니! 하고 외친다", startSeconds: 1, endSeconds: 2.5, origin: "suggestion" as const, suggestionId: "s1", sourceVideoId: "top" };
    const calls = backend({
      [GET]: [{ status: 200, body: workspace({ analysis: ANALYSIS, cardsSavedAt: SAVED_AT }) }],
      [PUT]: [{ status: 200, body: workspace({ analysis: ANALYSIS, cards: [savedCard], cardsSavedAt: "2026-10-07T16:30:00.000Z" }) }],
    });
    renderPanel();

    fireEvent.click(await screen.findByTestId("meme-suggestion-import-s1"));
    expect(screen.getByTestId("meme-card-origin-0").textContent).toBe("Gemini 제안에서 가져옴");
    expect((screen.getByTestId("meme-suggestion-import-s1") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("meme-card-text-0"), { target: { value: "니코니코니! 하고 외친다" } });
    expect(screen.getByTestId("meme-card-origin-0").textContent).toBe("Gemini 제안에서 가져옴 · 고침");

    fireEvent.click(screen.getByTestId("meme-cards-save"));
    await screen.findByTestId("meme-cards-saved");
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.body).toEqual({
      cards: [{ kind: "line", text: "니코니코니! 하고 외친다", startSeconds: 1, endSeconds: 2.5, origin: "suggestion", suggestionId: "s1", sourceVideoId: "top" }],
      expectedCardsSavedAt: SAVED_AT,
    });
    expect(screen.queryByTestId("meme-cards-unsaved")).toBeNull();
  });

  it("says what is wrong with a card before sending it", async () => {
    const calls = backend({ [GET]: [{ status: 200, body: workspace() }] });
    renderPanel();
    await screen.findByTestId("meme-analysis-calls");

    fireEvent.click(screen.getByTestId("meme-cards-add"));
    expect(screen.getByTestId("meme-card-problem-0").textContent).toContain("글자를 적어");
    fireEvent.change(screen.getByTestId("meme-card-text-0"), { target: { value: "점프" } });
    fireEvent.change(screen.getByTestId("meme-card-start-0"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("meme-card-end-0"), { target: { value: "3" } });
    expect(screen.getByTestId("meme-card-problem-0").textContent).toContain("끝 시간이 시작보다");
    expect((screen.getByTestId("meme-cards-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("meme-card-end-0"), { target: { value: "6.25" } });
    expect(screen.getByTestId("meme-card-problem-0").textContent).toContain("소수 한 자리");
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  /** 방금 추가한 빈 카드의 「글자를 적어 주세요」는 할 일 안내라 오류색이 아니고, 쓰기 시작해 틀리면 그때 오류색이 된다. */
  it("does not paint the empty new card red, but does once a real mistake is typed", async () => {
    backend({ [GET]: [{ status: 200, body: workspace() }] });
    renderPanel();
    await screen.findByTestId("meme-analysis-calls");
    expect(screen.getByTestId("meme-observations-howto").textContent).toContain("카드 저장");

    fireEvent.click(screen.getByTestId("meme-cards-add"));
    expect(screen.getByTestId("meme-card-problem-0").className).not.toContain("rose");
    expect(screen.getByTestId("meme-card-text-0").getAttribute("aria-invalid")).toBe("false");
    expect((screen.getByTestId("meme-card-text-0") as HTMLTextAreaElement).placeholder).toContain("예:");

    fireEvent.change(screen.getByTestId("meme-card-text-0"), { target: { value: "점프" } });
    fireEvent.change(screen.getByTestId("meme-card-start-0"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("meme-card-end-0"), { target: { value: "3" } });
    expect(screen.getByTestId("meme-card-problem-0").className).toContain("rose");
    expect(screen.getByTestId("meme-card-text-0").getAttribute("aria-invalid")).toBe("true");
  });

  /** 🔴 동시 저장(409): 입력은 남고, 다시 읽은 뒤 저장하면 새 기준 시각으로 보냅니다. */
  it("keeps the typed cards on a save conflict and saves against the re-read time", async () => {
    const calls = backend({
      [GET]: [{ status: 200, body: workspace({ cardsSavedAt: SAVED_AT }) }, { status: 200, body: workspace({ cardsSavedAt: "2026-10-07T17:00:00.000Z" }) }],
      [PUT]: [
        { status: 409, body: { code: "MEME_CARDS_CONFLICT", message: "raw" } },
        { status: 200, body: workspace({ cards: [{ id: "c9", kind: "gesture", text: "손 흔들기", startSeconds: null, endSeconds: null, origin: "manual", sourceVideoId: null }], cardsSavedAt: "2026-10-07T17:05:00.000Z" }) },
      ],
    });
    renderPanel();
    await screen.findByTestId("meme-analysis-calls");

    fireEvent.click(screen.getByTestId("meme-cards-add"));
    fireEvent.change(screen.getByTestId("meme-card-kind-0"), { target: { value: "gesture" } });
    fireEvent.change(screen.getByTestId("meme-card-text-0"), { target: { value: "손 흔들기" } });
    fireEvent.click(screen.getByTestId("meme-cards-save"));

    const alert = await screen.findByTestId("meme-cards-save-error");
    expect(alert.getAttribute("data-error-code")).toBe("MEME_CARDS_CONFLICT");
    expect((screen.getByTestId("meme-card-text-0") as HTMLTextAreaElement).value).toBe("손 흔들기");

    fireEvent.click(within(alert).getByTestId("meme-cards-reload"));
    await waitFor(() => expect(calls.filter((call) => call.method === "GET")).toHaveLength(2));
    expect((screen.getByTestId("meme-card-text-0") as HTMLTextAreaElement).value).toBe("손 흔들기");
    await waitFor(() => expect((screen.getByTestId("meme-cards-save") as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByTestId("meme-cards-save"));
    await screen.findByTestId("meme-cards-saved");
    const puts = calls.filter((call) => call.method === "PUT");
    expect((puts[1]!.body as { expectedCardsSavedAt: string }).expectedCardsSavedAt).toBe("2026-10-07T17:00:00.000Z");
  });

  it("says a candidate that left the list cannot be opened, without offering a retry that would fail the same way", async () => {
    backend({ [GET]: [{ status: 404, body: { code: "MEME_TREND_UNKNOWN", message: "raw" } }] });
    renderPanel();
    const error = await screen.findByTestId("meme-observations-load-error");
    expect(error.textContent).toContain("다시 열립니다");
    expect(error.textContent).not.toContain("지워");
    expect(within(error).queryByRole("button")).toBeNull();
  });
});
