import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemeTrend, MemeTrendFeedResponse, MemeTrendVideo } from "@ai-animation-studio/shared";
import { MEME_TREND_MIN_CHANNELS, MEME_TREND_MIN_VIDEOS } from "@ai-animation-studio/shared";
import { stubFetchByRoute } from "../api/testUtils.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { MemeTrendsScreen } from "./MemeTrendsScreen.js";

const OBSERVED = new Date(Date.now() - 2 * 3_600_000).toISOString();

function video(overrides: Partial<MemeTrendVideo> = {}): MemeTrendVideo {
  return {
    videoId: "v1",
    url: "https://www.youtube.com/watch?v=v1",
    title: "니코니코니 챌린지 따라 해 봄",
    channelId: "c1",
    channelTitle: "채널 하나",
    publishedAt: "2026-10-06T03:00:00.000Z",
    thumbnailUrl: "https://i.ytimg.com/vi/v1/mqdefault.jpg",
    viewCount: 120_000,
    viewCountObservedAt: OBSERVED,
    ...overrides,
  };
}

const NIKO: MemeTrend = {
  id: "hashtag-nikonikoni",
  name: "#니코니코니",
  evidence: [{ kind: "hashtag", text: "#니코니코니", videoCount: 3 }, { kind: "phrase", text: "니코니코니", videoCount: 2 }],
  videos: [
    video(),
    video({ videoId: "v2", url: "https://www.youtube.com/watch?v=v2", channelId: "c2", channelTitle: "채널 둘", viewCount: 45_000, previousViewCount: 30_000, previousViewCountObservedAt: "2026-10-06T00:00:00.000Z" }),
    video({ videoId: "v3", url: "https://www.youtube.com/watch?v=v3", channelId: "c2", channelTitle: "채널 둘", viewCount: null, thumbnailUrl: null }),
  ],
  channelCount: 2,
  firstObservedAt: OBSERVED,
  lastObservedAt: OBSERVED,
};

const L_TAKE: MemeTrend = {
  ...NIKO,
  id: "phrase-l",
  name: "L을 가져가",
  evidence: [{ kind: "phrase", text: "L을 가져가", videoCount: 3 }],
  videos: NIKO.videos.map((item) => ({ ...item, videoId: `l-${item.videoId}`, viewCount: null })),
};

function feed(overrides: Partial<MemeTrendFeedResponse> = {}): MemeTrendFeedResponse {
  return { source: "youtube", regionCode: "KR", collectedAt: OBSERVED, trends: [NIKO, L_TAKE], ...overrides };
}

function renderScreen(props: Partial<Parameters<typeof MemeTrendsScreen>[0]> = {}) {
  const onSelect = vi.fn();
  const onOpenSettings = vi.fn();
  render(<MemeTrendsScreen onSelect={onSelect} onOpenSettings={onOpenSettings} onProjectCreated={() => {}} {...props} />);
  return { onSelect, onOpenSettings };
}

describe("MemeTrendsScreen", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** 🔴 화면을 여는 것만으로는 YouTube 를 부르지 않습니다 — 읽기 길 하나만 나갑니다. */
  it("reads the stored list only on open, without spending YouTube quota", async () => {
    const fetchMock = stubFetchByRoute({ "GET /trends/memes": feed() });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen();

    await screen.findByTestId("meme-trends-list");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/trends/memes");
    expect(screen.getByTestId("meme-trends-count").textContent).toBe("2");
  });

  /** 🔴 범위 줄은 항상 — YouTube 뿐이고, Instagram·TikTok 이 아니고, 영상 내용을 본 게 아니라는 것. */
  it("always says the source, the collection time and what it does not cover", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed() }));
    renderScreen();

    const scope = await screen.findByTestId("meme-trends-scope");
    expect(scope.textContent).toContain("YouTube 공식 API");
    expect(scope.textContent).toContain("Instagram·TikTok 유행은 포함하지 않고");
    expect(scope.textContent).toContain(`채널 ${MEME_TREND_MIN_CHANNELS}곳 이상, 영상 ${MEME_TREND_MIN_VIDEOS}편 이상`);
    expect(screen.getByTestId("meme-trends-collected-at").textContent).toBe(formatDateTime(OBSERVED));
  });

  /** 숫자는 셋뿐: 공개된 최고 조회수, 영상 수, 채널 수. 점수도 합산 조회수도 없습니다. */
  it("shows real view counts, video and channel counts — and says 비공개 instead of inventing a number", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed() }));
    renderScreen();

    const stats = await screen.findByTestId(`meme-trend-stats-${NIKO.id}`);
    expect(stats.textContent).toBe("최고 조회수 120,000회 · 영상 3편 · 채널 2곳");
    expect(screen.getByTestId(`meme-trend-stats-${L_TAKE.id}`).textContent).toContain("최고 조회수 비공개");
  });

  it("selects a candidate through onSelect", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed() }));
    const { onSelect } = renderScreen();
    const card = await screen.findByTestId(`meme-trend-open-${NIKO.id}`);
    expect(card.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(card);
    expect(onSelect).toHaveBeenLastCalledWith(NIKO.id);
  });

  it("marks the chosen candidate pressed and unselects it on a second press", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed() }));
    const { onSelect } = renderScreen({ trendId: NIKO.id });
    const card = await screen.findByTestId(`meme-trend-open-${NIKO.id}`);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(card);
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  /** 상세: 묶인 영상마다 채널·게시일·조회수와 **그 수를 읽은 시각**, 새 탭 링크, 재수집이 있을 때만 증가분. */
  it("shows the grouped source videos of the chosen candidate with when each count was read", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed() }));
    renderScreen({ trendId: NIKO.id });

    const detail = await screen.findByTestId("meme-trend-detail");
    expect(detail.textContent).toContain("#니코니코니 · 영상 3편");
    expect(detail.textContent).toContain("“니코니코니” · 영상 2편");
    expect(screen.getByTestId("meme-video-views-v1").textContent).toContain(`조회수 120,000회 (${formatDateTime(OBSERVED)}에 읽음)`);
    expect(screen.getByTestId("meme-video-views-v3").textContent).toContain("조회수 비공개");

    const link = within(screen.getByTestId("meme-video-v1")).getByRole("link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://www.youtube.com/watch?v=v1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    expect(screen.getByTestId("meme-video-growth-v2").textContent).toContain("+15,000회");
    expect(screen.queryByTestId("meme-video-growth-v1")).toBeNull();
  });

  it("says when a remembered candidate is no longer in the list instead of showing an empty detail", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed() }));
    const { onSelect } = renderScreen({ trendId: "gone" });

    await screen.findByTestId("meme-trend-missing");
    expect(screen.queryByTestId("meme-trend-detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "목록만 보기" }));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it("tells never-collected apart from collected-but-empty", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed({ collectedAt: null, trends: [] }) }));
    renderScreen();
    expect((await screen.findByTestId("meme-trends-never")).textContent).toContain("할당량");
    expect(screen.queryByTestId("meme-trends-none")).toBeNull();
  });

  it("warns that counts are old once the last collection is a day old", async () => {
    const old = new Date(Date.now() - 30 * 3_600_000).toISOString();
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed({ collectedAt: old, trends: [] }) }));
    renderScreen();
    expect((await screen.findByTestId("meme-trends-stale")).textContent).toContain("30시간 전");
  });

  it("refreshes through the POST route and shows the new list", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /trends/memes": feed({ collectedAt: null, trends: [] }),
      "POST /trends/memes/refresh": feed({ trends: [NIKO] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen();

    await screen.findByTestId("meme-trends-never");
    fireEvent.click(screen.getByTestId("meme-trends-refresh"));
    await screen.findByTestId(`meme-trend-open-${NIKO.id}`);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/trends/memes/refresh" && (init as RequestInit | undefined)?.method === "POST")).toBe(true);
    expect(screen.getByTestId("meme-trends-count").textContent).toBe("1");
  });

  /** 🔴 키가 없으면 할 일이 있는 문장과 API 설정으로 가는 버튼. 보고 있던 목록은 지우지 않습니다. */
  it("keeps the old list and offers API 설정 when the YouTube key is missing", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute(
      { "GET /trends/memes": feed() },
      { "POST /trends/memes/refresh": { status: 400, body: { code: "MEME_TREND_KEY_MISSING", message: "raw" } } },
    ));
    const { onOpenSettings } = renderScreen();

    await screen.findByTestId("meme-trends-list");
    fireEvent.click(screen.getByTestId("meme-trends-refresh"));
    const alert = await screen.findByTestId("meme-trends-refresh-error");
    expect(alert.getAttribute("data-error-code")).toBe("MEME_TREND_KEY_MISSING");
    expect(alert.textContent).toContain("API 설정의 YouTube 칸");
    expect(alert.textContent).not.toContain("raw");
    expect(screen.getByTestId(`meme-trend-open-${NIKO.id}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId("meme-trends-open-settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  /** CLI Round 1271: 구글 할당량은 태평양 시간 자정에 돌아옵니다 — 한국의 「내일」이라고 약속하지 않습니다. */
  it("names the quota case as wait-for-the-reset, without promising 내일 or a settings button", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute(
      { "GET /trends/memes": feed() },
      { "POST /trends/memes/refresh": { status: 429, body: { code: "MEME_TREND_QUOTA_EXCEEDED", message: "raw" } } },
    ));
    renderScreen();
    await screen.findByTestId("meme-trends-list");
    fireEvent.click(screen.getByTestId("meme-trends-refresh"));
    const alert = await screen.findByTestId("meme-trends-refresh-error");
    expect(alert.textContent).toContain("재설정 시각");
    expect(alert.textContent).not.toContain("내일");
    expect(screen.queryByTestId("meme-trends-open-settings")).toBeNull();
  });

  it("says the stored list could not be read, rather than showing it as empty", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({}, { "GET /trends/memes": { status: 500, body: { code: "MEME_TREND_STORE_UNREADABLE", message: "raw" } } }));
    renderScreen();
    const error = await screen.findByTestId("meme-trends-load-error");
    expect(error.getAttribute("data-error-code")).toBe("MEME_TREND_STORE_UNREADABLE");
    expect(screen.queryByTestId("meme-trends-never")).toBeNull();
    await waitFor(() => expect((screen.getByTestId("meme-trends-refresh") as HTMLButtonElement).disabled).toBe(false));
  });

  it("refuses a malformed list", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": { source: "tiktok", regionCode: "KR", collectedAt: null, trends: [] } }));
    renderScreen();
    expect((await screen.findByTestId("meme-trends-load-error")).getAttribute("data-error-code")).toBe("CLIENT_MALFORMED_RESPONSE");
  });
});
