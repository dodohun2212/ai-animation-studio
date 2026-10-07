import * as fs from "node:fs/promises";
import * as path from "node:path";

import { HttpException, HttpStatus } from "@nestjs/common";
import {
  MEME_TREND_MIN_CHANNELS, MEME_TREND_MIN_VIDEOS, isMemeTrendFeedResponse,
  type ApiError, type MemeTrend, type MemeTrendEvidence,
  type MemeTrendFeedResponse, type MemeTrendVideo,
} from "@ai-animation-studio/shared";

import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";

const API_ROOT = "https://www.googleapis.com/youtube/v3";
const SEARCH_TERMS = ["밈 챌린지", "유행어 챌린지", "요즘 밈"] as const;
const SEARCH_DAYS = 30;
// YouTube's non-authorized API data must be refreshed or deleted after 30 days.
const CACHE_MAX_AGE_MS = 30 * 86_400_000;
const GENERIC_NAMES = new Set(["밈", "챌린지", "쇼츠", "shorts", "댄스", "춤", "유행", "유행어", "요즘", "추천", "귀여운", "재밌는", "fyp", "foryou", "viral", "reels", "trending", "trend", "kpop", "funny"]);

type YoutubeSearchItem = { id?: { videoId?: string } };
export type YoutubeVideoItem = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    tags?: string[];
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
  statistics?: { viewCount?: string };
  contentDetails?: { duration?: string };
};

type MemeErrorCode = "MEME_TREND_KEY_MISSING" | "MEME_TREND_QUOTA_EXCEEDED" | "MEME_TREND_SOURCE_FAILED" | "MEME_TREND_STORE_UNREADABLE";
function memeError(code: MemeErrorCode, message: string, status: HttpStatus): HttpException {
  const body: ApiError = { code, message };
  return new HttpException(body, status);
}

function apiItems<T>(value: unknown): T[] {
  if (typeof value !== "object" || value === null || !("items" in value) || !Array.isArray(value.items)) {
    throw memeError("MEME_TREND_SOURCE_FAILED", "YouTube 응답의 영상 목록을 읽지 못했습니다. 다시 모아 주세요.", HttpStatus.BAD_GATEWAY);
  }
  return value.items as T[];
}

function evidenceOf(video: YoutubeVideoItem): Array<{ kind: MemeTrendEvidence["kind"]; text: string; key: string }> {
  const title = video.snippet?.title ?? "";
  const description = video.snippet?.description ?? "";
  const evidence = new Map<string, { kind: MemeTrendEvidence["kind"]; text: string; key: string }>();
  const add = (kind: MemeTrendEvidence["kind"], text: string, core: string): void => {
    const key = core.toLocaleLowerCase("ko-KR").replace(/[\s_]+/gu, "");
    if (GENERIC_NAMES.has(key) || /^\d+$/u.test(key)) return;
    evidence.set(`${kind}:${text.toLocaleLowerCase("ko-KR")}`, { kind, text, key });
  };
  for (const match of `${title} ${description.slice(0, 300)}`.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)) {
    if (match[1]) add("hashtag", `#${match[1]}`, match[1]);
  }
  for (const match of title.matchAll(/(?<![#\p{L}\p{N}])([\p{L}\p{N}]{2,24})\s*(챌린지|밈)/gu)) {
    if (match[1]) add("phrase", match[0], match[1]);
  }
  // Catchphrases are often written as a short quotation rather than a hashtag (for example, "L을 가져가").
  for (const match of title.matchAll(/[「“‘"]([^」”’"]{3,32})[」”’"]/gu)) {
    const phrase = match[1]?.trim();
    if (phrase) add("phrase", phrase, phrase);
  }
  for (const tag of video.snippet?.tags?.slice(0, 20) ?? []) {
    const phrase = tag.trim();
    if (phrase.length >= 2 && phrase.length <= 32) add("phrase", phrase, phrase);
  }
  return [...evidence.values()].slice(0, 8);
}

function shortVideo(item: YoutubeVideoItem): boolean {
  const match = /^PT(?:(\d+)M)?(?:(\d+)S)?$/u.exec(item.contentDetails?.duration ?? "");
  if (!match) return false;
  const seconds = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return seconds > 0 && seconds < 240;
}

function toTrendVideo(item: YoutubeVideoItem, observedAt: string, previous?: MemeTrendVideo): MemeTrendVideo | null {
  const id = item.id;
  const snippet = item.snippet;
  if (!id || !/^[\w-]{11}$/u.test(id) || !snippet?.title || !snippet.channelId || !snippet.publishedAt || !shortVideo(item)) return null;
  const rawViews = item.statistics?.viewCount;
  const parsedViews = rawViews === undefined ? null : Number(rawViews);
  const viewCount = parsedViews !== null && Number.isSafeInteger(parsedViews) && parsedViews >= 0 ? parsedViews : null;
  const thumbnail = snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? null;
  const thumbnailUrl = thumbnail && /^https:\/\/i.ytimg.com\//u.test(thumbnail) ? thumbnail : null;
  return {
    videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title: snippet.title,
    channelId: snippet.channelId, channelTitle: snippet.channelTitle ?? snippet.channelId,
    publishedAt: snippet.publishedAt, thumbnailUrl, viewCount, viewCountObservedAt: observedAt,
    ...(viewCount !== null && previous?.viewCount !== null && previous?.viewCount !== undefined
      ? { previousViewCount: previous.viewCount, previousViewCountObservedAt: previous.viewCountObservedAt } : {}),
  };
}

/** Same observed name in three videos from two channels is a candidate; metadata alone does not verify a common gesture. */
export function groupMemeCandidates(items: YoutubeVideoItem[], observedAt: string, previous: MemeTrend[] = []): MemeTrend[] {
  const priorById = new Map(previous.map((trend) => [trend.id, trend]));
  const priorVideoById = new Map(previous.flatMap((trend) => trend.videos.map((video) => [video.videoId, video] as const)));
  const groups = new Map<string, { videos: Map<string, MemeTrendVideo>; evidence: Map<string, MemeTrendEvidence> }>();
  const seenVideoIds = new Set<string>();
  for (const item of items) {
    const id = item.id;
    const video = toTrendVideo(item, observedAt, id ? priorVideoById.get(id) : undefined);
    if (!video || seenVideoIds.has(video.videoId)) continue;
    seenVideoIds.add(video.videoId);
    for (const found of evidenceOf(item)) {
      const group = groups.get(found.key) ?? { videos: new Map<string, MemeTrendVideo>(), evidence: new Map<string, MemeTrendEvidence>() };
      group.videos.set(video.videoId, video);
      const evidenceKey = `${found.kind}:${found.text.toLocaleLowerCase("ko-KR")}`;
      const evidence = group.evidence.get(evidenceKey) ?? { kind: found.kind, text: found.text, videoCount: 0 };
      evidence.videoCount += 1;
      group.evidence.set(evidenceKey, evidence);
      groups.set(found.key, group);
    }
  }
  return [...groups.entries()].flatMap(([id, group]) => {
    const videos = [...group.videos.values()].sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
    const channelCount = new Set(videos.map((video) => video.channelId)).size;
    if (videos.length < MEME_TREND_MIN_VIDEOS || channelCount < MEME_TREND_MIN_CHANNELS) return [];
    const evidence = [...group.evidence.values()].sort((a, b) => b.videoCount - a.videoCount || a.text.localeCompare(b.text, "ko"));
    return [{ id, name: evidence[0]!.text.replace(/^#/u, ""), evidence, videos, channelCount, firstObservedAt: priorById.get(id)?.firstObservedAt ?? observedAt, lastObservedAt: observedAt }];
  }).sort((a, b) => {
    // The best video from a different channel matters first: one creator's many viral clips are not spread.
    const supportA = a.videos.find((video) => video.channelId !== a.videos[0]?.channelId)?.viewCount ?? 0;
    const supportB = b.videos.find((video) => video.channelId !== b.videos[0]?.channelId)?.viewCount ?? 0;
    const viewsA = a.videos.reduce((sum, video) => sum + (video.viewCount ?? 0), 0);
    const viewsB = b.videos.reduce((sum, video) => sum + (video.viewCount ?? 0), 0);
    return supportB - supportA || viewsB - viewsA || b.channelCount - a.channelCount;
  }).slice(0, 12);
}

export class MemeTrendsService {
  private readonly cachePath: string;
  private refreshInFlight: Promise<MemeTrendFeedResponse> | null = null;

  constructor(root: string, private readonly settings: ProviderSettingsService, private readonly fetchImpl: typeof fetch = globalThis.fetch, private readonly now: () => Date = () => new Date()) {
    this.cachePath = path.join(root, "meme_trends_youtube.json");
  }

  async get(): Promise<MemeTrendFeedResponse> { return this.readCache(); }

  async refresh(): Promise<MemeTrendFeedResponse> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const request = this.collect();
    this.refreshInFlight = request;
    try { return await request; }
    finally { if (this.refreshInFlight === request) this.refreshInFlight = null; }
  }

  private async collect(): Promise<MemeTrendFeedResponse> {
    const previous = await this.readCache();
    const key = await this.settings.rawCredentialIfConnected("youtube");
    if (!key) throw memeError("MEME_TREND_KEY_MISSING", "YouTube Data API 키가 없습니다. API 설정에서 저장해 주세요.", HttpStatus.BAD_REQUEST);
    const items = await this.fetchVideos(key);
    const observedAt = this.now().toISOString();
    const next: MemeTrendFeedResponse = { source: "youtube", regionCode: "KR", collectedAt: observedAt, trends: groupMemeCandidates(items, observedAt, previous.trends) };
    try {
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      await atomicWriteUtf8File(this.cachePath, JSON.stringify(next));
    } catch { throw memeError("MEME_TREND_STORE_UNREADABLE", "밈 후보 저장 파일을 쓸 수 없습니다. meme_trends_youtube.json을 확인해 주세요.", HttpStatus.INTERNAL_SERVER_ERROR); }
    return next;
  }

  private async readCache(): Promise<MemeTrendFeedResponse> {
    try {
      const data: unknown = JSON.parse(await fs.readFile(this.cachePath, "utf8"));
      if (!isMemeTrendFeedResponse(data)) throw new Error("invalid cache");
      if (data.collectedAt && this.now().getTime() - Date.parse(data.collectedAt) >= CACHE_MAX_AGE_MS) {
        await fs.unlink(this.cachePath);
        return { source: "youtube", regionCode: "KR", collectedAt: null, trends: [] };
      }
      return data;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") {
        return { source: "youtube", regionCode: "KR", collectedAt: null, trends: [] };
      }
      throw memeError("MEME_TREND_STORE_UNREADABLE", "밈 후보 저장 파일을 읽을 수 없습니다. meme_trends_youtube.json을 확인해 주세요.", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async request(pathname: string, key: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${API_ROOT}/${pathname}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    // YouTube documents a key query parameter for unauthenticated requests. Never log this URL or caught errors.
    url.searchParams.set("key", key);
    assertRealNetworkCallAllowed("YouTube Data API", this.fetchImpl);
    let response: Response;
    try { response = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) }); }
    catch { throw memeError("MEME_TREND_SOURCE_FAILED", "YouTube에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 모아 주세요.", HttpStatus.BAD_GATEWAY); }
    if (!response.ok) {
      let reason = "";
      try {
        const body = await response.json() as { error?: { errors?: Array<{ reason?: string }> } };
        reason = body.error?.errors?.[0]?.reason ?? "";
      } catch { /* Status remains the evidence when no JSON body is available. */ }
      if (response.status === 429 || reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
        throw memeError("MEME_TREND_QUOTA_EXCEEDED", "YouTube API 할당량이 끝났습니다. 구글 클라우드 콘솔에서 재설정 시각을 확인한 뒤 다시 모아 주세요.", HttpStatus.TOO_MANY_REQUESTS);
      }
      throw memeError("MEME_TREND_SOURCE_FAILED", "YouTube에서 밈 후보를 가져오지 못했습니다. API 키와 서비스 활성화 상태를 확인해 주세요.", HttpStatus.BAD_GATEWAY);
    }
    try { return await response.json(); }
    catch { throw memeError("MEME_TREND_SOURCE_FAILED", "YouTube 응답을 읽지 못했습니다. 다시 모아 주세요.", HttpStatus.BAD_GATEWAY); }
  }

  private async fetchVideos(key: string): Promise<YoutubeVideoItem[]> {
    const publishedAfter = new Date(this.now().getTime() - SEARCH_DAYS * 86_400_000).toISOString();
    const ids = new Set<string>();
    for (const q of SEARCH_TERMS) {
      const result = await this.request("search", key, { part: "snippet", type: "video", regionCode: "KR", relevanceLanguage: "ko", publishedAfter, videoDuration: "short", order: "viewCount", maxResults: "50", q });
      for (const item of apiItems<YoutubeSearchItem>(result)) if (item.id?.videoId) ids.add(item.id.videoId);
    }
    const all: YoutubeVideoItem[] = [];
    const videoIds = [...ids];
    for (let offset = 0; offset < videoIds.length; offset += 50) {
      const result = await this.request("videos", key, { part: "snippet,statistics,contentDetails", id: videoIds.slice(offset, offset + 50).join(","), maxResults: "50" });
      all.push(...apiItems<YoutubeVideoItem>(result));
    }
    return all;
  }
}
