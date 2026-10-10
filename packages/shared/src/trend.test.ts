import { describe, expect, it } from "vitest";

import { isMemeTrendFeedResponse, isMemeTrendWorkspace, memeVideoAgeAverageViewsPerHour, memeVideoGrowth, type MemeTrendVideo } from "./trend.js";

const observedAt = "2026-10-08T00:00:00.000Z";
const trend = {
  id: "니코니코니", name: "니코니코니", channelCount: 2,
  firstObservedAt: observedAt, lastObservedAt: observedAt,
  evidence: [{ kind: "hashtag", text: "#니코니코니", videoCount: 3 }],
  videos: [{ videoId: "aaaaaaaaaaa", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", title: "예시", channelId: "a", channelTitle: "A", publishedAt: observedAt, thumbnailUrl: null, viewCount: null, viewCountObservedAt: observedAt }],
};

describe("meme trend response guards", () => {
  it("accepts an empty feed and a trend with an unreported view count", () => {
    expect(isMemeTrendFeedResponse({ source: "youtube", regionCode: "KR", collectedAt: null, trends: [] })).toBe(true);
    expect(isMemeTrendFeedResponse({ source: "youtube", regionCode: "KR", collectedAt: observedAt, trends: [trend] })).toBe(true);
  });

  it("refuses partial previous view observations and invented zero-shaped fields", () => {
    const feed = { source: "youtube", regionCode: "KR", collectedAt: observedAt, trends: [trend] };
    expect(isMemeTrendFeedResponse(feed)).toBe(true);
    expect(isMemeTrendFeedResponse({ ...feed, trends: [{ ...trend, videos: [{ ...trend.videos[0], previousViewCount: 10 }] }] })).toBe(false);
    expect(isMemeTrendFeedResponse({ ...feed, trends: [{ ...trend, videos: [{ ...trend.videos[0], viewCount: "0" }] }] })).toBe(false);
  });
});

describe("observed meme video growth", () => {
  const measured: MemeTrendVideo = {
    ...trend.videos[0]!, viewCount: 350, viewCountObservedAt: "2026-10-09T12:00:00.000Z",
    previousViewCount: 200, previousViewCountObservedAt: observedAt,
  };

  it("returns a 24-hour-normalized average only for a valid measured interval", () => {
    expect(memeVideoGrowth(measured)).toEqual({ viewsGained: 150, viewsPerDay: 100 });
    expect(memeVideoGrowth({ ...measured, viewCountObservedAt: "2026-10-09T00:00:00.000Z" })).toEqual({ viewsGained: 150, viewsPerDay: 150 });
    expect(memeVideoGrowth({ ...measured, viewCountObservedAt: "2026-10-08T23:59:59.000Z" })).toBeNull();
  });

  it("refuses first reads, falling counts, reversed times and expired anchors", () => {
    expect(memeVideoGrowth({ ...measured, previousViewCount: undefined, previousViewCountObservedAt: undefined })).toBeNull();
    expect(memeVideoGrowth({ ...measured, viewCount: 199 })).toBeNull();
    expect(memeVideoGrowth({ ...measured, viewCountObservedAt: "2026-10-07T00:00:00.000Z" })).toBeNull();
    expect(memeVideoGrowth({ ...measured, viewCountObservedAt: "2026-11-07T00:00:00.000Z" })).toBeNull();
  });

  it("keeps the publish-age average separate and caps the first six hours", () => {
    expect(memeVideoAgeAverageViewsPerHour({ ...measured, viewCount: 600, publishedAt: "2026-10-09T10:00:00Z" })).toBe(100);
    expect(memeVideoAgeAverageViewsPerHour({ ...measured, viewCount: null })).toBeNull();
    expect(memeVideoAgeAverageViewsPerHour({ ...measured, publishedAt: "2026-10-10T00:00:00Z" })).toBeNull();
  });
});

describe("meme observation workspace guard", () => {
  const workspace = {
    trendId: "니코니코니", analyses: [], cardsSavedAt: observedAt,
    cards: [{ id: "card-1", kind: "gesture", text: "손을 든다", startSeconds: 2.5, endSeconds: 4, origin: "manual", sourceVideoId: null }],
    dailyCalls: { used: 1, limit: 3 },
  };

  it("accepts saved manual cards and rejects malformed times or call counts", () => {
    expect(isMemeTrendWorkspace(workspace)).toBe(true);
    expect(isMemeTrendWorkspace({ ...workspace, cards: [{ ...workspace.cards[0], endSeconds: 1 }] })).toBe(false);
    expect(isMemeTrendWorkspace({ ...workspace, dailyCalls: { used: "1", limit: 3 } })).toBe(false);
  });

  it("rejects repeated source videos", () => {
    const analysis = { sourceVideoId: "aaaaaaaaaaa", provider: "gemini", model: "test", analyzedAt: observedAt, suggestions: [] };
    expect(isMemeTrendWorkspace({ ...workspace, analyses: [analysis] })).toBe(true);
    expect(isMemeTrendWorkspace({ ...workspace, analyses: [analysis, { ...analysis, sourceVideoId: "bbbbbbbbbbb" }] })).toBe(true);
    expect(isMemeTrendWorkspace({ ...workspace, analyses: [analysis, { ...analysis }] })).toBe(false);
  });
});
