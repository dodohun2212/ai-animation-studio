import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { groupMemeCandidates, MemeTrendsService } from "./meme-trends.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const video = (id: string, channelId: string, title: string, viewCount = "10000") => ({
  id,
  snippet: { title, channelId, channelTitle: channelId, publishedAt: "2026-10-07T00:00:00Z", thumbnails: { medium: { url: "https://i.ytimg.com/vi/test/mqdefault.jpg" } } },
  statistics: { viewCount },
  contentDetails: { duration: "PT30S" },
});
const sample = [
  video("aaaaaaaaaaa", "creator-a", "#니코니코니 #fyp", "200000"),
  video("bbbbbbbbbbb", "creator-b", "#니코니코니 도전", "300000"),
  video("ccccccccccc", "creator-c", "#니코니코니", "400000"),
];
const observedAt = "2026-10-08T00:00:00.000Z";

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meme-trends-")); roots.push(root);
  const settings = new ProviderSettingsService(new ProviderSettingsRepository(root));
  return { root, settings };
}

describe("meme trend discovery", () => {
  it("requires repeated evidence from three videos and three channels, and preserves measured views", () => {
    expect(groupMemeCandidates(sample.slice(0, 2), observedAt)).toEqual([]);
    expect(groupMemeCandidates([sample[0]!, sample[1]!, video("ddddddddddd", "creator-b", "#니코니코니", "500000")], observedAt)).toEqual([]);
    const trends = groupMemeCandidates(sample, observedAt);
    expect(trends).toHaveLength(1);
    expect(trends[0]).toMatchObject({ name: "니코니코니", channelCount: 3, evidence: [{ kind: "hashtag", text: "#니코니코니", videoCount: 3 }] });
    expect(trends[0]?.videos.map((item) => item.viewCount)).toEqual([400000, 300000, 200000]);
    const later = groupMemeCandidates([video("aaaaaaaaaaa", "creator-a", "#니코니코니", "250000"), ...sample.slice(1)], "2026-10-09T00:00:00Z", trends);
    expect(later[0]?.firstObservedAt).toBe(observedAt);
    expect(later[0]?.videos.find((item) => item.videoId === "aaaaaaaaaaa")).toMatchObject({ previousViewCount: 200000, previousViewCountObservedAt: observedAt });
  });

  it("keeps the earlier observation across quick refreshes and resets after a falling count", () => {
    const first = groupMemeCandidates(sample, observedAt);
    const oneHour = groupMemeCandidates([
      video("aaaaaaaaaaa", "creator-a", "#니코니코니", "210000"), ...sample.slice(1),
    ], "2026-10-08T01:00:00.000Z", first);
    const aAfterHour = oneHour[0]?.videos.find((item) => item.videoId === "aaaaaaaaaaa");
    expect(aAfterHour).toMatchObject({ previousViewCount: 200000, previousViewCountObservedAt: observedAt });
    const nextDay = groupMemeCandidates([
      video("aaaaaaaaaaa", "creator-a", "#니코니코니", "250000"), ...sample.slice(1),
    ], "2026-10-09T01:00:00.000Z", oneHour);
    expect(nextDay[0]?.videos.find((item) => item.videoId === "aaaaaaaaaaa")).toMatchObject({
      previousViewCount: 200000, previousViewCountObservedAt: observedAt,
    });
    const falling = groupMemeCandidates([
      video("aaaaaaaaaaa", "creator-a", "#니코니코니", "240000"), ...sample.slice(1),
    ], "2026-10-09T02:00:00.000Z", nextDay);
    expect(falling[0]?.videos.find((item) => item.videoId === "aaaaaaaaaaa")?.previousViewCount).toBeUndefined();
  });

  it("groups a repeated quoted catchphrase without requiring a hashtag", () => {
    const quoted = [
      video("ddddddddddd", "creator-a", "오늘은 ‘L을 가져가’"),
      video("eeeeeeeeeee", "creator-b", "“L을 가져가” 따라 하기"),
      video("fffffffffff", "creator-c", "「L을 가져가」 장면"),
    ];
    const trends = groupMemeCandidates(quoted, observedAt);
    expect(trends[0]).toMatchObject({ name: "L을 가져가", channelCount: 3, evidence: [{ kind: "phrase", text: "L을 가져가", videoCount: 3 }] });
  });

  it("rejects broad tags and standalone game names while keeping a concrete challenge", () => {
    // These names were present in the user's saved candidate feed; only 권루트 was
    // judged to identify a specific pattern rather than a topic or format.
    const broad = "#challenge #mario #memes #comedy #meme #웃긴영상 #animation #sonic #roblox #릴스 #relatable";
    const items = [
      video("aaaaaaaaaaa", "creator-a", `${broad} #권루트`),
      video("bbbbbbbbbbb", "creator-b", `${broad} #권루트`),
      video("ccccccccccc", "creator-c", `${broad} #권루트`),
    ];
    expect(groupMemeCandidates(items, observedAt).map((trend) => trend.name)).toEqual(["권루트"]);
    expect(groupMemeCandidates(items.map((item) => ({ ...item, snippet: { ...item.snippet, title: broad } })), observedAt)).toEqual([]);
  });

  it("normalizes format tags and merges overlapping names without losing saved IDs", () => {
    const items = [
      video("aaaaaaaaaaa", "a", "#권루트 #L을가져가 #TikTok", "20000"),
      video("bbbbbbbbbbb", "b", "#권루트 #L을가져가 #funny_memes", "30000"),
      video("ccccccccccc", "c", "#권루트 #L을가져가 #YouTubeShorts", "40000"),
    ];
    const merged = groupMemeCandidates(items, observedAt);
    expect(merged).toHaveLength(1);
    expect([merged[0]!.id, ...(merged[0]!.aliases ?? [])].sort()).toEqual(["l을가져가", "권루트"].sort());
    expect(merged[0]!.videos).toHaveLength(3);
    expect(groupMemeCandidates(items, observedAt, [], { protectedIds: new Set(["l을가져가"]) })[0]?.id).toBe("l을가져가");
    expect(groupMemeCandidates(items, observedAt, [], { protectedIds: new Set(["l을가져가", "권루트"]) })).toHaveLength(2);
  });

  it("does not let one shared video bridge unrelated three-channel patterns", () => {
    const items = [
      video("aaaaaaaaaaa", "a", "#첫패턴 #둘째패턴", "10000"),
      video("bbbbbbbbbbb", "b", "#첫패턴", "10000"),
      video("ccccccccccc", "c", "#첫패턴", "10000"),
      video("ddddddddddd", "d", "#둘째패턴", "10000"),
      video("eeeeeeeeeee", "e", "#둘째패턴", "10000"),
    ];
    expect(groupMemeCandidates(items, observedAt)).toHaveLength(2);
  });

  it("ranks recent independent participation and captures reaction and subscriber evidence", () => {
    const items = [
      ...sample.map((item) => ({ ...item, statistics: { viewCount: item.statistics.viewCount, likeCount: "120", commentCount: "12" } })),
      video("ddddddddddd", "d", "#새로운춤", "20000"),
      video("eeeeeeeeeee", "e", "#새로운춤", "20000"),
      video("fffffffffff", "f", "#새로운춤", "20000"),
    ];
    const trends = groupMemeCandidates(items, observedAt, [], { subscribers: new Map([ ["creator-a", 1000], ["creator-b", 2000], ["creator-c", null] ]) });
    expect(trends.find((trend) => trend.id === "니코니코니")).toMatchObject({ recentChannelCount: 3, medianViewsPerSubscriber: 175 });
    expect(trends.find((trend) => trend.id === "니코니코니")?.medianViewsPerHour).toBeGreaterThan(0);
    expect(trends.find((trend) => trend.id === "니코니코니")?.videos[0]).toMatchObject({ likeCount: 120, commentCount: 12, channelSubscriberCount: null });
  });

  it("ranks a meme supported by another popular creator above one dominant clip", () => {
    const trends = groupMemeCandidates([
      video("ggggggggggg", "solo", "#한방밈", "9000000"),
      video("hhhhhhhhhhh", "solo", "#한방밈", "8000000"),
      video("iiiiiiiiiii", "other", "#한방밈", "1000"),
      video("mmmmmmmmmmm", "third", "#한방밈", "500"),
      video("jjjjjjjjjjj", "a", "#퍼진밈", "300000"),
      video("kkkkkkkkkkk", "b", "#퍼진밈", "250000"),
      video("lllllllllll", "c", "#퍼진밈", "200000"),
    ], observedAt);
    expect(trends.map((trend) => trend.name)).toEqual(["퍼진밈"]);
  });

  it("reads the saved feed without calling YouTube, and refuses refresh without a key", async () => {
    const { root, settings } = await setup();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl);
    expect(await service.get()).toEqual({ source: "youtube", regionCode: "KR", collectedAt: null, trends: [] });
    await expect(service.refresh()).rejects.toMatchObject({ response: { code: "MEME_TREND_KEY_MISSING" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hides broad names from an older saved feed without refreshing or changing its file", async () => {
    const { root, settings } = await setup();
    const cachePath = path.join(root, "meme_trends_youtube.json");
    const concrete = groupMemeCandidates(sample, observedAt)[0]!;
    const broad = { ...concrete, id: "memes", name: "memes" };
    const saved = JSON.stringify({ source: "youtube", regionCode: "KR", collectedAt: observedAt, trends: [broad, concrete] });
    await fs.writeFile(cachePath, saved, "utf8");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl, () => new Date("2026-10-09T00:00:00Z"));
    expect((await service.get()).trends.map((trend) => trend.name)).toEqual(["니코니코니"]);
    expect(await fs.readFile(cachePath, "utf8")).toBe(saved);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes with mocked metadata, remembers previous observations, and preserves cache on failure", async () => {
    const { root, settings } = await setup();
    await settings.save("youtube", { value: "mock-youtube-data-api-key" });
    const fetchMock = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/channels")) return { ok: true, json: async () => ({ items: [
        { id: "creator-a", statistics: { subscriberCount: "1000" } },
        { id: "creator-b", statistics: { subscriberCount: "2000" } },
        { id: "creator-c", statistics: { hiddenSubscriberCount: true, subscriberCount: "5000" } },
      ] }) } as Response;
      const items = url.pathname.endsWith("/search")
        ? sample.map((item) => ({ id: { videoId: item.id } })) : sample;
      return { ok: true, json: async () => ({ items }) } as Response;
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl, () => new Date(observedAt));
    const first = await service.refresh();
    expect(first.trends[0]?.videos[0]?.viewCount).toBe(400000);
    expect(first.trends[0]?.videos.find((video) => video.channelId === "creator-c")?.channelSubscriberCount).toBeNull();
    expect(first.trends[0]?.medianViewsPerSubscriber).toBe(175);
    expect(first.trends[0]?.discoverySources).toEqual(["search", "music-chart", "popular"]);
    expect(first.trends[0]?.songs?.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(28);
    const searchUrls = fetchMock.mock.calls.map(([url]) => url).filter((url) => url.pathname.endsWith("/search"));
    expect(searchUrls).toHaveLength(22);
    expect(searchUrls.slice(0, 8).map((url) => url.searchParams.get("order"))).toEqual(["viewCount", "date", "viewCount", "date", "viewCount", "date", "viewCount", "date"]);
    expect(searchUrls[0]?.searchParams.get("publishedAfter")).toBe("2026-09-08T00:00:00.000Z");
    expect(searchUrls[1]?.searchParams.get("publishedAfter")).toBe("2026-10-01T00:00:00.000Z");
    const detailUrl = fetchMock.mock.calls.map(([url]) => url).find((url) => url.pathname.endsWith("/videos") && url.searchParams.has("id"));
    expect(detailUrl?.searchParams.get("id")).toBe("aaaaaaaaaaa,bbbbbbbbbbb,ccccccccccc");
    const chartUrl = fetchMock.mock.calls.map(([url]) => url).find((url) => url.searchParams.get("chart") === "mostPopular" && !url.searchParams.has("videoCategoryId"));
    expect(chartUrl?.searchParams.get("regionCode")).toBe("KR");
    expect(chartUrl?.searchParams.get("part")).toBe("snippet,statistics,contentDetails");
    expect(await service.get()).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(28);

    const laterFetch = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const later = new MemeTrendsService(root, settings, laterFetch, () => new Date("2026-10-09T00:00:00Z"));
    await expect(later.refresh()).rejects.toMatchObject({ response: { code: "MEME_TREND_SOURCE_FAILED" } });
    expect(await later.get()).toEqual(first);
  });

  it("includes recent creator videos that are absent from the view-count search", async () => {
    const { root, settings } = await setup();
    await settings.save("youtube", { value: "mock-youtube-data-api-key" });
    const fetchImpl = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/search")) {
        const ids = url.searchParams.get("order") === "date" ? [sample[2]!.id] : [sample[0]!.id, sample[1]!.id];
        return { ok: true, json: async () => ({ items: ids.map((id) => ({ id: { videoId: id } })) }) } as Response;
      }
      return { ok: true, json: async () => ({ items: sample.filter((item) => url.searchParams.get("id")?.includes(item.id)) }) } as Response;
    }) as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl, () => new Date(observedAt));
    const feed = await service.refresh();
    expect(feed.trends[0]?.channelCount).toBe(3);
    expect(feed.trends[0]?.videos).toHaveLength(3);
  });

  it("discovers a short-video meme from the popularity chart without a search match", async () => {
    const { root, settings } = await setup();
    await settings.save("youtube", { value: "mock-youtube-data-api-key" });
    const longVideo = { ...video("ddddddddddd", "creator-d", "#니코니코니"), contentDetails: { duration: "PT4M" } };
    const oldVideo = { ...video("eeeeeeeeeee", "creator-e", "#니코니코니"), snippet: { ...video("eeeeeeeeeee", "creator-e", "#니코니코니").snippet, publishedAt: "2026-08-01T00:00:00Z" } };
    const fetchMock = vi.fn(async (url: URL) => ({
      ok: true,
      json: async () => ({ items: url.searchParams.get("chart") === "mostPopular" ? [...sample, longVideo, oldVideo] : [] }),
    } as Response));
    const service = new MemeTrendsService(root, settings, fetchMock as unknown as typeof fetch, () => new Date(observedAt));
    const feed = await service.refresh();
    expect(feed.trends).toHaveLength(1);
    expect(feed.trends[0]?.videos).toHaveLength(3);
    expect(fetchMock.mock.calls.filter(([url]) => url.searchParams.get("chart") === "mostPopular")).toHaveLength(4);
  });

  it("distinguishes provider quota refusal from transport failure and keeps the prior feed", async () => {
    const { root, settings } = await setup();
    await settings.save("youtube", { value: "mock-youtube-data-api-key" });
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: "quotaExceeded" }] } }) } as Response)) as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl);
    await expect(service.refresh()).rejects.toMatchObject({ response: { code: "MEME_TREND_QUOTA_EXCEEDED" } });
    expect(await service.get()).toMatchObject({ collectedAt: null, trends: [] });
    expect(JSON.parse(await fs.readFile(path.join(root, "meme_trend_refresh_usage.json"), "utf8"))).toMatchObject({ used: 1 });
  });

  it("reserves at most four manual collections per Pacific day before contacting YouTube", async () => {
    const { root, settings } = await setup();
    await settings.save("youtube", { value: "mock-youtube-data-api-key" });
    const fetchMock = vi.fn(async (url: URL) => ({ ok: true, json: async () => ({ items: url.pathname.endsWith("/search")
      ? sample.map((item) => ({ id: { videoId: item.id } })) : url.searchParams.has("id") && url.pathname.endsWith("/videos") ? sample : [] }) } as Response));
    const service = new MemeTrendsService(root, settings, fetchMock as unknown as typeof fetch, () => new Date(observedAt));
    for (let i = 0; i < 4; i++) await service.refresh();
    const calls = fetchMock.mock.calls.length;
    await expect(service.refresh()).rejects.toMatchObject({ response: { code: "MEME_TREND_LOCAL_LIMIT_REACHED" } });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(JSON.parse(await fs.readFile(path.join(root, "meme_trend_refresh_usage.json"), "utf8"))).toMatchObject({ used: 4 });
  });

  it("refuses an unreadable saved feed before contacting YouTube", async () => {
    const { root, settings } = await setup();
    await fs.writeFile(path.join(root, "meme_trends_youtube.json"), "broken", "utf8");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl);
    await expect(service.refresh()).rejects.toMatchObject({ response: { code: "MEME_TREND_STORE_UNREADABLE" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deletes YouTube metadata at 30 days instead of serving an old view count", async () => {
    const { root, settings } = await setup();
    const cachePath = path.join(root, "meme_trends_youtube.json");
    await fs.writeFile(cachePath, JSON.stringify({ source: "youtube", regionCode: "KR", collectedAt: observedAt, trends: groupMemeCandidates(sample, observedAt) }), "utf8");
    const service = new MemeTrendsService(root, settings, vi.fn() as unknown as typeof fetch, () => new Date("2026-11-08T00:00:00Z"));
    expect(await service.get()).toEqual({ source: "youtube", regionCode: "KR", collectedAt: null, trends: [] });
    await expect(fs.stat(cachePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
