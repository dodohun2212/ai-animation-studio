import { describe, expect, it } from "vitest";

import { isMemeTrendFeedResponse, isMemeTrendWorkspace } from "./trend.js";

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

describe("meme observation workspace guard", () => {
  const workspace = {
    trendId: "니코니코니", analysis: null, cardsSavedAt: observedAt,
    cards: [{ id: "card-1", kind: "gesture", text: "손을 든다", startSeconds: 2.5, endSeconds: 4, origin: "manual", sourceVideoId: null }],
    dailyCalls: { used: 1, limit: 3 },
  };

  it("accepts saved manual cards and rejects malformed times or call counts", () => {
    expect(isMemeTrendWorkspace(workspace)).toBe(true);
    expect(isMemeTrendWorkspace({ ...workspace, cards: [{ ...workspace.cards[0], endSeconds: 1 }] })).toBe(false);
    expect(isMemeTrendWorkspace({ ...workspace, dailyCalls: { used: "1", limit: 3 } })).toBe(false);
  });
});
