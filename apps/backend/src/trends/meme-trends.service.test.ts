import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { groupMemeCandidates, MemeTrendsService } from "./meme-trends.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const video = (id: string, channelId: string, title: string, viewCount?: string) => ({
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
    expect(trends.map((trend) => trend.name)).toEqual(["퍼진밈", "한방밈"]);
  });

  it("reads the saved feed without calling YouTube, and refuses refresh without a key", async () => {
    const { root, settings } = await setup();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl);
    expect(await service.get()).toEqual({ source: "youtube", regionCode: "KR", collectedAt: null, trends: [] });
    await expect(service.refresh()).rejects.toMatchObject({ response: { code: "MEME_TREND_KEY_MISSING" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes with mocked metadata, remembers previous observations, and preserves cache on failure", async () => {
    const { root, settings } = await setup();
    await settings.save("youtube", { value: "mock-youtube-data-api-key" });
    const fetchMock = vi.fn(async (url: URL) => {
      const items = url.pathname.endsWith("/search")
        ? sample.map((item) => ({ id: { videoId: item.id } })) : sample;
      return { ok: true, json: async () => ({ items }) } as Response;
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl, () => new Date(observedAt));
    const first = await service.refresh();
    expect(first.trends[0]?.videos[0]?.viewCount).toBe(400000);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    const searchUrls = fetchMock.mock.calls.map(([url]) => url).filter((url) => url.pathname.endsWith("/search"));
    expect(searchUrls).toHaveLength(6);
    expect(searchUrls.map((url) => url.searchParams.get("order"))).toEqual(["viewCount", "date", "viewCount", "date", "viewCount", "date"]);
    expect(searchUrls[0]?.searchParams.get("publishedAfter")).toBe("2026-09-08T00:00:00.000Z");
    expect(searchUrls[1]?.searchParams.get("publishedAfter")).toBe("2026-10-01T00:00:00.000Z");
    const detailUrl = fetchMock.mock.calls.map(([url]) => url).find((url) => url.pathname.endsWith("/videos"));
    expect(detailUrl?.searchParams.get("id")).toBe("aaaaaaaaaaa,bbbbbbbbbbb,ccccccccccc");
    const chartUrl = fetchMock.mock.calls.map(([url]) => url).find((url) => url.searchParams.get("chart") === "mostPopular");
    expect(chartUrl?.searchParams.get("regionCode")).toBe("KR");
    expect(chartUrl?.searchParams.get("part")).toBe("snippet,statistics,contentDetails");
    expect(await service.get()).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(8);

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
    expect(fetchMock.mock.calls.filter(([url]) => url.searchParams.get("chart") === "mostPopular")).toHaveLength(1);
  });

  it("distinguishes provider quota refusal from transport failure and keeps the prior feed", async () => {
    const { root, settings } = await setup();
    await settings.save("youtube", { value: "mock-youtube-data-api-key" });
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: "quotaExceeded" }] } }) } as Response)) as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl);
    await expect(service.refresh()).rejects.toMatchObject({ response: { code: "MEME_TREND_QUOTA_EXCEEDED" } });
    expect(await service.get()).toMatchObject({ collectedAt: null, trends: [] });
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
