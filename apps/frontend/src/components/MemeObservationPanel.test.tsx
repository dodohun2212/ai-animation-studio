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
  return { trendId: "niko", analyses: [], cards: [], cardsSavedAt: null, dailyCalls: { used: 0, limit: 3 }, ...overrides };
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
      [ANALYZE]: [{ status: 200, body: workspace({ analyses: [ANALYSIS], dailyCalls: { used: 1, limit: 3 } }) }],
    });
    renderPanel();
    await screen.findByTestId("meme-analysis-calls");

    fireEvent.change(screen.getByTestId("meme-analysis-video"), { target: { value: "low" } });
    fireEvent.click(screen.getByTestId("meme-analysis-run"));

    await screen.findByTestId("meme-suggestions");
    expect(calls.filter((call) => call.method === "POST")).toEqual([{ method: "POST", url: "/trends/memes/niko/analysis", body: { sourceVideoId: "low" } }]);
    expect(screen.getByTestId("meme-suggestion-top-s1").textContent).toContain("0:01–0:02.5");
    expect(screen.getByTestId("meme-suggestions-source-top").textContent).toContain("「많이 본 영상」");
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
      [GET]: [{ status: 200, body: workspace({ analyses: [ANALYSIS], cardsSavedAt: SAVED_AT }) }],
      [PUT]: [{ status: 200, body: workspace({ analyses: [ANALYSIS], cards: [savedCard], cardsSavedAt: "2026-10-07T16:30:00.000Z" }) }],
    });
    renderPanel();

    fireEvent.click(await screen.findByTestId("meme-suggestion-import-top-s1"));
    expect(screen.getByTestId("meme-card-origin-0").textContent).toBe("Gemini 제안에서 가져옴");
    expect((screen.getByTestId("meme-suggestion-import-top-s1") as HTMLButtonElement).disabled).toBe(true);

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

  /** CLI 1340: 역할은 계산된 것만 — 도달 규모(최대 조회수), 실측 증가(계산된 영상 중 최고), 내용 분석(성공한 출처). */
  it("names each representative video by the number behind it, and leaves out roles that were not computed", async () => {
    const day = 24 * 60 * 60 * 1000;
    const grown = { ...TREND, videos: TREND.videos.map((video) => video.videoId === "low"
      ? { ...video, previousViewCount: 4, previousViewCountObservedAt: new Date(Date.parse(OBSERVED) - 2 * day).toISOString() }
      : video) };
    backend({ [GET]: [{ status: 200, body: workspace({ analyses: [ANALYSIS] }) }] });
    render(<MemeObservationPanel trend={grown} onOpenSettings={() => {}} onProjectCreated={() => {}} />);
    expect((await screen.findByTestId("meme-role-reach")).textContent).toContain("「많이 본 영상」 · 채널 B · 공개 조회수 9,000회");
    expect(screen.getByTestId("meme-role-growth").textContent).toContain("「적게 본 영상」 · 채널 A · 지난 수집 이후 하루 평균 +3회");
    expect(screen.getByTestId("meme-role-analyzed").textContent).toBe("「많이 본 영상」 · 채널 B");
  });

  it("draws no growth or analysis role when none was measured or analysed", async () => {
    backend({ [GET]: [{ status: 200, body: workspace() }] });
    renderPanel();
    await screen.findByTestId("meme-role-reach");
    expect(screen.queryByTestId("meme-role-growth")).toBeNull();
    expect(screen.queryByTestId("meme-role-analyzed")).toBeNull();
    expect(screen.queryByText(/공통 패턴/)).toBeNull();
  });

  /** 출처별 비교 — 제안 ID 가 출처마다 겹쳐도 하나만 가져오고, 카드는 출처 영상·분석 시각을 말한다. 피드에서 빠진 출처도 읽힌다. */
  it("compares suggestions side by side per source, keeps a source that left the feed, and imports only the one picked", async () => {
    const gone = { ...ANALYSIS, sourceVideoId: "gone-video", analyzedAt: "2026-10-06T09:00:00.000Z", suggestions: [{ id: "s1", kind: "timing" as const, text: "후렴에 맞춰 멈춘다", startSeconds: null, endSeconds: null }] };
    const calls = backend({ [GET]: [{ status: 200, body: workspace({ analyses: [ANALYSIS, gone] }) }] });
    renderPanel();
    expect((await screen.findByTestId("meme-suggestions-source-gone-video")).textContent).toContain("목록에서 빠진 영상 (gone-video)");
    expect(screen.getByTestId("meme-suggestions-source-top").textContent).toContain("「많이 본 영상」 · 채널 B");
    expect(screen.getByTestId("meme-cards-empty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("meme-suggestion-import-gone-video-s1"));
    expect((screen.getByTestId("meme-suggestion-import-gone-video-s1") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("meme-suggestion-import-top-s1") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("meme-card-origin-0").textContent).toBe("Gemini 제안에서 가져옴");
    expect(screen.getByTestId("meme-card-source-0").textContent).toContain("목록에서 빠진 영상 (gone-video)");
    expect(screen.getByTestId("meme-card-source-0").textContent).toContain("분석");
    expect(screen.getByTestId("meme-cards-unsaved")).toBeTruthy();
    // 가져오기만으로는 저장하지 않는다 — 사람이 「카드 저장」을 눌러야 한다.
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  /** 같은 제작자의 다른 영상은 고를 수 없고, 이미 분석한 영상은 「다시 분석」(그 영상 제안만 바뀜)으로 열려 있다. */
  it("does not let an already analysed creator be picked again, but allows re-analysing the same video", async () => {
    const calls = backend({ [GET]: [{ status: 200, body: workspace({ analyses: [ANALYSIS] }) }] });
    renderPanel();
    const select = (await screen.findByTestId("meme-analysis-video")) as HTMLSelectElement;
    expect(select.value).toBe("top");
    expect(screen.getByTestId("meme-analysis-run").textContent).toContain("다시 분석");
    const hidden = Array.from(select.options).find((option) => option.value === "hidden")!;
    expect(hidden.disabled).toBe(true);
    expect(hidden.textContent).toContain("채널 B · 비공개 조회수");
    expect(Array.from(select.options).find((option) => option.value === "low")!.disabled).toBe(false);

    fireEvent.change(select, { target: { value: "hidden" } });
    expect(screen.getByTestId("meme-analysis-blocked").textContent).toContain("이 제작자의 영상은 이미 분석했습니다");
    expect((screen.getByTestId("meme-analysis-run") as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("refuses a new source while an earlier source is missing from the feed, and at the three-source limit", async () => {
    const gone = { ...ANALYSIS, sourceVideoId: "gone-video" };
    backend({ [GET]: [{ status: 200, body: workspace({ analyses: [gone] }) }] });
    const { unmount } = render(<MemeObservationPanel trend={TREND} onOpenSettings={() => {}} onProjectCreated={() => {}} />);
    expect((await screen.findByTestId("meme-analysis-blocked")).textContent).toContain("목록에서 빠져");
    expect((screen.getByTestId("meme-analysis-run") as HTMLButtonElement).disabled).toBe(true);
    unmount();

    const three = { ...TREND, videos: [...TREND.videos, { ...TREND.videos[0]!, videoId: "c-video", channelId: "c", channelTitle: "채널 C" }, { ...TREND.videos[0]!, videoId: "d-video", channelId: "d", channelTitle: "채널 D" }] };
    backend({ [GET]: [{ status: 200, body: workspace({ analyses: ["low", "top", "c-video"].map((sourceVideoId) => ({ ...ANALYSIS, sourceVideoId })) }) }] });
    render(<MemeObservationPanel trend={three} onOpenSettings={() => {}} onProjectCreated={() => {}} />);
    const select = (await screen.findByTestId("meme-analysis-video")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "d-video" } });
    expect(screen.getByTestId("meme-analysis-blocked").textContent).toContain("3편을 이미 분석했습니다");
    expect(screen.getByTestId("meme-analysis-sources").textContent).toContain("지금 3편");
  });

  /** 화면 판단이 어긋나도 서버 코드가 막고, 문장은 코드마다 고정 — 횟수는 그대로라고 말한다. 다른 출처 분석은 남는다. */
  it("shows a fixed sentence for the server's source refusals and keeps the other analyses", async () => {
    backend({
      [GET]: [{ status: 200, body: workspace({ analyses: [ANALYSIS] }) }],
      [ANALYZE]: [{ status: 409, body: { code: "MEME_ANALYSIS_CHANNEL_ALREADY_USED", message: "raw" } }],
    });
    renderPanel();
    fireEvent.change(await screen.findByTestId("meme-analysis-video"), { target: { value: "low" } });
    fireEvent.click(screen.getByTestId("meme-analysis-run"));
    const alert = await screen.findByTestId("meme-analysis-error");
    expect(alert.getAttribute("data-error-code")).toBe("MEME_ANALYSIS_CHANNEL_ALREADY_USED");
    expect(alert.textContent).toContain("횟수도 그대로");
    expect(alert.textContent).not.toContain("raw");
    expect(screen.getByTestId("meme-analysis-source-top")).toBeTruthy();
  });

  /** 성공하면 서버가 준 분석 목록(다른 출처 포함)으로 바꾸고, 저장 시각은 위로 알린다(「이 밈으로 만들기」가 다시 읽는 신호). */
  it("adopts the server's analysis list after a new source and reports the saved time upward", async () => {
    const low = { ...ANALYSIS, sourceVideoId: "low", suggestions: [{ id: "s1", kind: "gesture" as const, text: "엄지 척", startSeconds: null, endSeconds: null }] };
    const onCardsSavedAt = vi.fn();
    backend({
      [GET]: [{ status: 200, body: workspace({ analyses: [ANALYSIS], cardsSavedAt: SAVED_AT }) }],
      [ANALYZE]: [{ status: 200, body: workspace({ analyses: [ANALYSIS, low], cardsSavedAt: SAVED_AT, dailyCalls: { used: 1, limit: 3 } }) }],
    });
    render(<MemeObservationPanel trend={TREND} onOpenSettings={() => {}} onProjectCreated={() => {}} onCardsSavedAt={onCardsSavedAt} />);
    await waitFor(() => expect(onCardsSavedAt).toHaveBeenCalledWith(SAVED_AT));
    fireEvent.change(screen.getByTestId("meme-analysis-video"), { target: { value: "low" } });
    fireEvent.click(screen.getByTestId("meme-analysis-run"));
    await screen.findByTestId("meme-analysis-source-low");
    expect(screen.getByTestId("meme-analysis-source-top")).toBeTruthy();
    expect(screen.getByTestId("meme-role-analyzed").textContent).toBe("「많이 본 영상」 · 채널 B / 「적게 본 영상」 · 채널 A");
    expect(screen.getByTestId("meme-cards-empty")).toBeTruthy();
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
