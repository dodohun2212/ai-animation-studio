import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { groupMemeCandidates, MemeTrendsService } from "./meme-trends.service.js";
import { MemeObservationService } from "./meme-observation.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function setup(fetchImpl: typeof fetch = vi.fn() as unknown as typeof fetch) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meme-observation-")); roots.push(root);
  const now = () => new Date("2026-10-08T01:00:00Z");
  const settings = new ProviderSettingsService(new ProviderSettingsRepository(root));
  const videos = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((id, i) => ({
    id, snippet: { title: "#니코니코니", channelId: `creator-${i}`, publishedAt: "2026-10-07T00:00:00Z" },
    statistics: { viewCount: "10000" }, contentDetails: { duration: "PT30S" },
  }));
  const trends = groupMemeCandidates(videos, now().toISOString());
  const trendId = trends[0]!.id;
  await fs.writeFile(path.join(root, "meme_trends_youtube.json"), JSON.stringify({ source: "youtube", regionCode: "KR", collectedAt: now().toISOString(), trends }));
  const service = new MemeObservationService(root, new MemeTrendsService(root, settings, vi.fn() as unknown as typeof fetch, now), settings, fetchImpl, now);
  return { root, settings, service, trendId };
}

describe("meme observation workspace", () => {
  it("reads and saves manual cards without a provider key, then rejects stale edits", async () => {
    const { service, trendId } = await setup();
    expect(await service.get(trendId)).toMatchObject({ analysis: null, cards: [], dailyCalls: { used: 0, limit: 3 } });
    const body = { expectedCardsSavedAt: null, cards: [{ kind: "gesture" as const, text: "  손을 든다  ", startSeconds: null, endSeconds: null, origin: "manual" as const, sourceVideoId: null }] };
    const saved = await service.saveCards(trendId, body);
    expect(saved.cards[0]).toMatchObject({ text: "손을 든다", origin: "manual" });
    expect((await service.get(trendId)).cards).toEqual(saved.cards);
    await expect(service.saveCards(trendId, body)).rejects.toMatchObject({ response: { code: "MEME_CARDS_CONFLICT" } });
    await expect(service.analyze(trendId, { sourceVideoId: "aaaaaaaaaaa" })).rejects.toMatchObject({ response: { code: "MEME_ANALYSIS_KEY_MISSING" } });
    expect((await service.get(trendId)).dailyCalls?.used).toBe(0);
  });

  it("counts a failed provider call, preserves manual edits, and caps the fourth call", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429 } as Response)) as unknown as typeof fetch;
    const { settings, service, trendId } = await setup(fetchImpl);
    await settings.save("gemini", { value: "mock-gemini-api-key-12345" });
    const saved = await service.saveCards(trendId, { expectedCardsSavedAt: null, cards: [{ kind: "line", text: "내 대사", startSeconds: null, endSeconds: null, origin: "manual", sourceVideoId: null }] });
    for (let used = 1; used <= 3; used++) {
      await expect(service.analyze(trendId, { sourceVideoId: "aaaaaaaaaaa" })).rejects.toMatchObject({ response: { code: "MEME_ANALYSIS_FAILED", details: { dailyCalls: { used, limit: 3 } } } });
    }
    await expect(service.analyze(trendId, { sourceVideoId: "aaaaaaaaaaa" })).rejects.toMatchObject({ response: { code: "MEME_ANALYSIS_DAILY_LIMIT_REACHED" } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((await service.get(trendId)).cards).toEqual(saved.cards);
    expect((await service.get(trendId)).analysis).toBeNull();
  });

  it("saves validated suggestions without changing cards and refuses videos outside the candidate", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ spokenPhrase: "짧은 말", gesture: "손을 든다", beats: [{ approxSeconds: 3, description: "멈춤" }], uncertainties: [] }) }] } }] }) } as Response)) as unknown as typeof fetch;
    const { settings, service, trendId } = await setup(fetchImpl);
    await settings.save("gemini", { value: "mock-gemini-api-key-12345" });
    await expect(service.analyze(trendId, { sourceVideoId: "zzzzzzzzzzz" })).rejects.toMatchObject({ response: { code: "MEME_ANALYSIS_VIDEO_NOT_IN_TREND" } });
    const result = await service.analyze(trendId, { sourceVideoId: "aaaaaaaaaaa" });
    expect(result.analysis?.suggestions.map((item) => item.kind)).toEqual(["line", "gesture", "timing"]);
    expect(result.analysis?.suggestions[2]?.startSeconds).toBe(3);
    expect(result.cards).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses an unreadable call ledger before any provider request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { root, settings, service, trendId } = await setup(fetchImpl);
    await settings.save("gemini", { value: "mock-gemini-api-key-12345" });
    await fs.writeFile(path.join(root, "meme_analysis_call_usage.json"), "broken");
    expect((await service.get(trendId)).dailyCalls).toBeNull();
    await expect(service.analyze(trendId, { sourceVideoId: "aaaaaaaaaaa" })).rejects.toMatchObject({ response: { code: "MEME_ANALYSIS_LEDGER_UNREADABLE" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
