import { describe, expect, it } from "vitest";

import { isMemeTrendFeedResponse } from "./trend.js";

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
