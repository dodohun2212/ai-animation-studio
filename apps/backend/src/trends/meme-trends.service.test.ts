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
  it("requires repeated evidence from three videos and two channels, and preserves measured views", () => {
    expect(groupMemeCandidates(sample.slice(0, 2), observedAt)).toEqual([]);
    const trends = groupMemeCandidates(sample, observedAt);
    expect(trends).toHaveLength(1);
    expect(trends[0]).toMatchObject({ name: "니코니코니", channelCount: 3, evidence: [{ kind: "hashtag", text: "#니코니코니", videoCount: 3 }] });
    expect(trends[0]?.videos.map((item) => item.viewCount)).toEqual([400000, 300000, 200000]);
    const later = groupMemeCandidates([video("aaaaaaaaaaa", "creator-a", "#니코니코니", "250000"), ...sample.slice(1)], "2026-10-09T00:00:00Z", trends);
    expect(later[0]?.firstObservedAt).toBe(observedAt);
    expect(later[0]?.videos.find((item) => item.videoId === "aaaaaaaaaaa")).toMatchObject({ previousViewCount: 200000, previousViewCountObservedAt: observedAt });
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

  it("ranks a meme supported by another popular creator above one dominant clip", () => {
    const trends = groupMemeCandidates([
      video("ggggggggggg", "solo", "#한방밈", "9000000"),
      video("hhhhhhhhhhh", "solo", "#한방밈", "8000000"),
      video("iiiiiiiiiii", "other", "#한방밈", "1000"),
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
    const fetchImpl = vi.fn(async (url: URL) => {
      const items = url.pathname.endsWith("/search")
        ? sample.map((item) => ({ id: { videoId: item.id } })) : sample;
      return { ok: true, json: async () => ({ items }) } as Response;
    }) as unknown as typeof fetch;
    const service = new MemeTrendsService(root, settings, fetchImpl, () => new Date(observedAt));
    const first = await service.refresh();
    expect(first.trends[0]?.videos[0]?.viewCount).toBe(400000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(await service.get()).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const laterFetch = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const later = new MemeTrendsService(root, settings, laterFetch, () => new Date("2026-10-09T00:00:00Z"));
    await expect(later.refresh()).rejects.toMatchObject({ response: { code: "MEME_TREND_SOURCE_FAILED" } });
    expect(await later.get()).toEqual(first);
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
