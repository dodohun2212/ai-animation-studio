import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemeTrend, MemeTrendFeedResponse, MemeTrendVideo } from "@ai-animation-studio/shared";
import { MEME_TREND_MIN_CHANNELS, MEME_TREND_MIN_THIRD_CREATOR_VIEWS, MEME_TREND_MIN_VIDEOS, MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY } from "@ai-animation-studio/shared";
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
    video({ videoId: "v3", url: "https://www.youtube.com/watch?v=v3", channelId: "c3", channelTitle: "채널 셋", viewCount: null, thumbnailUrl: null }),
  ],
  channelCount: 3,
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
    expect(stats.textContent).toBe("최고 조회수 120,000회 · 영상 3편 · 채널 3곳");
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

    const measured = screen.getByTestId("meme-video-growth-v2");
    expect(measured.getAttribute("data-growth")).toBe("measured");
    expect(measured.textContent).toContain("관찰 기간 평균 +");
    expect(measured.textContent).toContain("/일");
    expect(measured.textContent).toContain("실제 +15,000회");
    expect(measured.textContent).toContain("비교 기준");
    expect(measured.textContent).not.toContain("지난 수집");
    // 계산되지 않은 영상마다 같은 안내를 되풀이하지 않는다 — 영상 줄에는 아무것도 없고, 목록 위 한 줄이 한 번만 말한다.
    expect(screen.queryByTestId("meme-video-growth-v1")).toBeNull();
    expect(screen.queryByTestId("meme-video-growth-v3")).toBeNull();
    const summary = screen.getByTestId("meme-growth-summary");
    expect(summary.getAttribute("data-growth")).toBe("partial");
    expect(summary.textContent).toContain("계산된 영상에만");
  });

  /** 백엔드는 조회수가 줄었거나 30일이 지나면 이전 값 필드를 생략한다 — 첫 수집과 같은 중립 한 줄이어야 하고, 영상마다 되풀이하지 않는다(CLI 1287·1307). */
  it("says one neutral line for first reads and for responses whose baseline the server cleared", async () => {
    const trend: MemeTrend = { ...NIKO, videos: [video({ videoId: "f1" }), video({ videoId: "f2", url: "https://www.youtube.com/watch?v=f2", channelId: "c2", viewCount: 10_000 }), NIKO.videos[2]!] };
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed({ trends: [trend] }) }));
    renderScreen({ trendId: NIKO.id });
    const summary = await screen.findByTestId("meme-growth-summary");
    expect(summary.getAttribute("data-growth")).toBe("no-baseline");
    expect(summary.textContent).toContain("비교할 이전 조회수가 없어");
    expect(summary.textContent).not.toContain("첫 수집");
    expect(screen.queryByTestId("meme-video-growth-f1")).toBeNull();
    expect(screen.queryByTestId("meme-video-growth-f2")).toBeNull();
    expect(screen.getAllByText(/비교할 이전 조회수가 없어/)).toHaveLength(1);
  });

  /** 🔴 비교 기준과 24시간이 안 지났거나 조회수가 줄었으면 속도를 지어내지 않는다 — 한 줄로만 말한다. */
  it.each([
    ["one hour later", { previousViewCount: 29_000, previousViewCountObservedAt: new Date(Date.parse(OBSERVED) - 3_600_000).toISOString() }, "too-short", "24시간이 안 지나"],
    ["25 hours later", { previousViewCount: 30_000, previousViewCountObservedAt: new Date(Date.parse(OBSERVED) - 25 * 3_600_000).toISOString() }, "measured", "관찰 기간 평균 +13,824회/일"],
    ["a falling count", { previousViewCount: 90_000, previousViewCountObservedAt: new Date(Date.parse(OBSERVED) - 48 * 3_600_000).toISOString() }, "invalid", "맞지 않아"],
    ["an anchor over 30 days old", { previousViewCount: 1_000, previousViewCountObservedAt: new Date(Date.parse(OBSERVED) - 40 * 86_400_000).toISOString() }, "invalid", "30일"],
  ] as const)("shows the right growth state for %s", async (_name, previous, state, text) => {
    const trend: MemeTrend = { ...NIKO, videos: [video({ videoId: "g1", viewCount: 44_400, ...previous }), NIKO.videos[2]!] };
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed({ trends: [trend] }) }));
    renderScreen({ trendId: NIKO.id });

    if (state === "measured") {
      const growth = await screen.findByTestId("meme-video-growth-g1");
      expect(growth.getAttribute("data-growth")).toBe("measured");
      expect(growth.textContent).toContain(text);
      expect(screen.queryByTestId("meme-growth-summary")).toBeNull();
      return;
    }
    const summary = await screen.findByTestId("meme-growth-summary");
    expect(summary.getAttribute("data-growth")).toBe(state);
    expect(summary.textContent).toContain(text);
    expect(summary.textContent).not.toMatch(/회\/일/);
    expect(screen.queryByTestId("meme-video-growth-g1")).toBeNull();
  });

  /** 같은 근거를 두 번 보여 주지 않는다: 후보 카드엔 칩이 없고(이름이 첫 근거), 상세에서 한 번만. 영상이 많으면 처음 5편만. */
  it("shows the evidence chips once, in the detail, and folds a long video list", async () => {
    const many: MemeTrend = { ...NIKO, videos: Array.from({ length: 8 }, (_, index) => video({ videoId: `m${index}`, url: `https://www.youtube.com/watch?v=m${index}`, channelId: `c${index}` })) };
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed({ trends: [many] }) }));
    renderScreen({ trendId: NIKO.id });
    const detail = await screen.findByTestId("meme-trend-detail");
    expect(screen.getByTestId(`meme-trend-open-${NIKO.id}`).textContent).not.toContain("영상 3편");
    expect(detail.textContent).toContain("#니코니코니 · 영상 3편");
    expect(within(screen.getByTestId(`meme-trend-open-${NIKO.id}`)).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(screen.getByTestId("meme-trend-videos")).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(screen.getByTestId("meme-videos-toggle"));
    expect(within(screen.getByTestId("meme-trend-videos")).getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByTestId("meme-videos-toggle").textContent).toBe("영상 줄여 보기");
  });

  /** 단계 띠: 후보 고르기 전 → 후보를 고름(카드 없음) → 저장한 카드가 있음. 앞 단계는 끝남, 지금 단계는 한 곳. */
  describe("flow ribbon", () => {
    const states = () => ["pick", "observe", "draft", "make"].map((key) => screen.getByTestId(`step-ribbon-${key}`).getAttribute("data-step-state"));
    const workspace = (cards: unknown[]) => ({ trendId: NIKO.id, analyses: [], cards, cardsSavedAt: cards.length ? OBSERVED : null, dailyCalls: { used: 0, limit: 3 } });

    it("starts at picking a meme and says what to do next", async () => {
      vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed() }));
      renderScreen();
      await screen.findByTestId("meme-trends-list");
      expect(states()).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
      expect(screen.getByTestId("meme-flow-hint").textContent).toContain("하나 고르세요");
    });

    it("moves to the observation step once a candidate is chosen with no saved cards", async () => {
      vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed(), [`GET /trends/memes/${NIKO.id}/workspace`]: workspace([]) }));
      renderScreen({ trendId: NIKO.id });
      await screen.findByTestId("meme-trend-detail");
      expect(states()).toEqual(["done", "current", "upcoming", "upcoming"]);
      expect(screen.queryByTestId("meme-flow-hint")).toBeNull();
    });

    it("moves to the draft step when saved cards exist, and leaves video making upcoming", async () => {
      const card = { id: "c1", kind: "gesture", text: "손을 든다", startSeconds: 1, endSeconds: 2, origin: "manual", sourceVideoId: null };
      vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed(), [`GET /trends/memes/${NIKO.id}/workspace`]: workspace([card]) }));
      renderScreen({ trendId: NIKO.id });
      await waitFor(() => expect(states()).toEqual(["done", "done", "current", "upcoming"]));
      expect(screen.queryByTestId("meme-flow-hint")).toBeNull();
    });

    /** CLI 1340: 카드가 없으면 「이 밈으로 만들기」가 관찰 카드 칸을 펼쳐 준다 — 분석·제안 고르기는 거기서 사람이 한다. */
    it("opens the observation cards from 이 밈으로 만들기 when no cards are saved", async () => {
      vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed(), [`GET /trends/memes/${NIKO.id}/workspace`]: workspace([]), "GET /assets?assetType=character": { assets: [] } }));
      renderScreen({ trendId: NIKO.id });
      const details = (await screen.findByTestId("meme-observations-details")) as HTMLDetailsElement;
      expect(details.open).toBe(false);
      fireEvent.click(await screen.findByTestId("meme-quick-open-cards"));
      await waitFor(() => expect(details.open).toBe(true));
    });

    it("lets the first step clear the chosen candidate", async () => {
      vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed(), [`GET /trends/memes/${NIKO.id}/workspace`]: workspace([]) }));
      const { onSelect } = renderScreen({ trendId: NIKO.id });
      await screen.findByTestId("meme-trend-detail");
      fireEvent.click(screen.getByTestId("step-ribbon-pick"));
      expect(onSelect).toHaveBeenLastCalledWith(undefined);
    });
  });

  /** 후보를 고르면 목록은 고른 한 장만 남고, 「다른 밈 고르기」로 되돌린다. */
  it("collapses the list to the chosen candidate and offers 다른 밈 고르기", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed() }));
    const { onSelect } = renderScreen({ trendId: NIKO.id });
    await screen.findByTestId("meme-trend-detail");
    expect(screen.getByTestId(`meme-trend-open-${NIKO.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`meme-trend-open-${L_TAKE.id}`)).toBeNull();
    fireEvent.click(screen.getByTestId("meme-trends-show-all"));
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it("keeps the whole list when nothing is chosen, and keeps the flow ribbon sticky", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed() }));
    renderScreen();
    await screen.findByTestId("meme-trends-list");
    expect(screen.getByTestId(`meme-trend-open-${L_TAKE.id}`)).toBeTruthy();
    expect(screen.queryByTestId("meme-trends-show-all")).toBeNull();
    expect(screen.getByTestId("meme-flow").className).toContain("sticky");
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

/** CLI 1355: 후보 선정 근거 숫자 — 정렬 순서대로 따로 보이고, 점수로 합치지 않으며, 없는 값은 「미수집」. */
describe("MemeTrendsScreen — selection signals (CLI 1355)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const SIGNALED: MemeTrend = {
    ...NIKO,
    id: "hashtag-kwon",
    name: "권루트",
    aliases: ["phrase-l-take"],
    recentChannelCount: 5,
    medianViewsPerHour: 1_234,
    medianViewsPerSubscriber: 2.5,
    discoverySources: ["search", "music-chart"],
    songs: [{ title: "STORM II", regionCode: "US", chartVideoId: "abcdefghijk" }],
    videos: [
      video({ likeCount: 900, commentCount: 40, channelSubscriberCount: 60_000 }),
      video({ videoId: "v2", url: "https://www.youtube.com/watch?v=v2", channelId: "c2", likeCount: null, commentCount: null, channelSubscriberCount: null, viewCount: 45_000, previousViewCount: 30_000, previousViewCountObservedAt: "2026-10-06T00:00:00.000Z" }),
      video({ videoId: "v3", url: "https://www.youtube.com/watch?v=v3", channelId: "c3" }),
    ],
  };
  const selectedServer = (trend: MemeTrend) => stubFetchByRoute({
    "GET /trends/memes": feed({ trends: [trend, L_TAKE] }),
    [`GET /trends/memes/${trend.id}/workspace`]: { trendId: trend.id, analyses: [], cards: [], cardsSavedAt: null, dailyCalls: { used: 0, limit: 3 } },
    "GET /assets?assetType=character": { assets: [] },
  });

  it("shows recent participation and the median hourly views on the card, and says when an old feed lacks them", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /trends/memes": feed({ trends: [SIGNALED, L_TAKE] }) }));
    renderScreen();
    expect((await screen.findByTestId("meme-trend-signals-hashtag-kwon")).textContent).toBe("최근 7일 참여 채널 5곳 · 시간당 1,234회(중간값)");
    expect(screen.getByTestId("meme-trend-signals-phrase-l").textContent).toBe("최근 7일 참여 미수집 · 시간당 조회수 미수집");
    expect(screen.getByTestId("meme-trends-order").textContent).toContain("하나의 점수가 아니며");
    expect(screen.getByTestId("meme-trends-scope").textContent).toContain("한국·미국·일본");
    expect(screen.getByTestId("meme-trends-recollect").textContent).toContain(`자동으로 모으지 않음 · 하루 ${MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY}회까지`);
    // CLI 1358: 하한 기준과 「후보일 뿐」 문구가 범위 줄에 shared 상수로.
    expect(screen.getByTestId("meme-trends-scope").textContent).toContain(`세 번째 채널 영상 조회수가 ${MEME_TREND_MIN_THIRD_CREATOR_VIEWS.toLocaleString("ko-KR")}회 이상`);
    expect(screen.getByTestId("meme-trends-scope").textContent).toContain("3,000회 이상");
    expect(screen.getByTestId("meme-trends-scope").textContent).toContain("유행을 확정한 것은 아닙니다");
    expect(document.body.textContent).not.toMatch(/점수 \d|트렌드 점수/);
  });

  it("opens a merged candidate from its old id, and lays out subscriber ratio, sources, chart songs and per-video reactions", async () => {
    vi.stubGlobal("fetch", selectedServer(SIGNALED));
    renderScreen({ trendId: "phrase-l-take" });
    await screen.findByTestId("meme-trend-detail");
    expect(screen.queryByTestId("meme-trend-missing")).toBeNull();
    expect(screen.getByTestId("meme-trend-per-subscriber").textContent).toBe("조회수가 구독자의 2.5배(중간값) · 순위 계산은 구독자 1,000명 미만을 1,000명으로 계산");
    expect(screen.getByTestId("meme-trend-sources").textContent).toBe("검색 · 음악 차트 곡 검색");
    const songs = screen.getByTestId("meme-trend-songs");
    expect(songs.textContent).toContain("STORM II (미국 음악 차트)");
    expect(songs.querySelector("a")!.getAttribute("href")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
    expect(songs.querySelector("a")!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByTestId("meme-video-reactions-v1").textContent).toBe("좋아요 900 · 댓글 40 · 구독자 60,000 · 구독자 대비 2배");
    expect(screen.getByTestId("meme-video-reactions-v2").textContent).toBe("좋아요 비공개 · 댓글 비공개 · 구독자 비공개");
    expect(screen.getByTestId("meme-video-reactions-v3").textContent).toBe("좋아요 미수집 · 댓글 미수집 · 구독자 미수집");
  });

  /** 실측 증가가 있는 영상은 그 값, 없는 영상만 「게시 후 평균」— 둘을 같은 이름으로 섞지 않는다. */
  it("keeps measured growth and the publish-age average apart", async () => {
    vi.stubGlobal("fetch", selectedServer(SIGNALED));
    renderScreen({ trendId: SIGNALED.id });
    await screen.findByTestId("meme-trend-detail");
    expect(screen.getByTestId("meme-video-growth-v2")).toBeTruthy();
    expect(screen.queryByTestId("meme-video-age-average-v2")).toBeNull();
    expect(screen.getByTestId("meme-video-age-average-v1").textContent).toContain("실측 증가 아님");
    expect(screen.queryByTestId("meme-video-age-average-v3")).toBeTruthy();
  });

  it("says a missing per-subscriber value was not collected rather than zero", async () => {
    const old: MemeTrend = { ...NIKO, id: "old-feed" };
    vi.stubGlobal("fetch", selectedServer(old));
    renderScreen({ trendId: "old-feed" });
    await screen.findByTestId("meme-trend-detail");
    expect(screen.getByTestId("meme-trend-per-subscriber").textContent).toBe("미수집");
    expect(screen.getByTestId("meme-trend-sources").textContent).toBe("미수집");
    expect(screen.queryByTestId("meme-trend-songs")).toBeNull();
  });

  /** CLI 1356: 하루 4회 한도는 앱이 막은 것 — YouTube 에 요청하지 않았다고 말하고, 지난 목록은 그대로. */
  it("explains the local daily collection limit and keeps the last list", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute(
      { "GET /trends/memes": feed() },
      { "POST /trends/memes/refresh": { status: 429, body: { code: "MEME_TREND_LOCAL_LIMIT_REACHED", message: "raw" } } },
    ));
    renderScreen();
    await screen.findByTestId("meme-trends-list");
    fireEvent.click(screen.getByTestId("meme-trends-refresh"));
    const alert = await screen.findByTestId("meme-trends-refresh-error");
    expect(alert.getAttribute("data-error-code")).toBe("MEME_TREND_LOCAL_LIMIT_REACHED");
    expect(alert.textContent).toContain("YouTube에는 요청하지 않았습니다");
    expect(alert.textContent).toContain(`수집 ${MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY}회 한도`);
    expect(alert.textContent).not.toContain("raw");
    expect(screen.getByTestId("meme-trends-list")).toBeTruthy();
  });
});
