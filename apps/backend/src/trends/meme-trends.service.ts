import * as fs from "node:fs/promises";
import * as path from "node:path";

import { HttpException, HttpStatus } from "@nestjs/common";
import {
  MEME_GROWTH_MAX_INTERVAL_MS, MEME_TREND_MIN_CHANNELS, MEME_TREND_MIN_VIDEOS,
  MEME_TREND_MIN_THIRD_CREATOR_VIEWS, MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY, isMemeTrendFeedResponse,
  memeVideoAgeAverageViewsPerHour, memeVideoGrowth,
  type ApiError, type MemeTrend, type MemeTrendEvidence,
  type MemeTrendFeedResponse, type MemeTrendVideo,
} from "@ai-animation-studio/shared";

import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";

const API_ROOT = "https://www.googleapis.com/youtube/v3";
const SEARCH_TERMS = ["밈 챌린지", "유행어 챌린지", "요즘 밈"] as const;
const SEARCH_DAYS = 30;
const RECENT_SEARCH_DAYS = 7;
const RECENT_MS = 7 * 86_400_000;
// YouTube's non-authorized API data must be refreshed or deleted after 30 days.
const CACHE_MAX_AGE_MS = 30 * 86_400_000;
// A repeated broad topic is not evidence that independent creators are copying one meme.
// Keep this list conservative: a concrete catchphrase or challenge name must still pass.
const GENERIC_NAMES = new Set([
  "밈", "챌린지", "쇼츠", "릴스", "댄스", "춤", "유행", "유행어", "요즘", "추천", "귀여운", "재밌는", "웃긴", "웃긴영상", "개그", "일상", "브이로그", "음악", "노래", "게임", "애니메이션",
  "meme", "memes", "challenge", "challenges", "short", "shorts", "ytshorts", "shortvideo", "shortsvideo", "shortsfeed", "youtubeshorts", "reels", "fyp", "foryou", "foryoupage", "viral", "viralvideo", "trending", "trendingnow", "trend", "funny", "funnymemes", "funnychallenge", "memechallenge", "comedy", "humor", "dance", "music", "song", "gaming", "game", "vlog", "daily", "edit", "asmr", "kpop", "animation", "relatable", "tiktok", "video", "guessthememe", "trynottolaugh", "compilation", "모음", "모음집", "퀴즈",
  // Standalone franchise/game topics commonly occur across unrelated short videos.
  "mario", "sonic", "roblox", "minecraft", "마리오", "소닉", "로블록스", "마인크래프트",
]);

type YoutubeSearchItem = { id?: { videoId?: string } };
type YoutubeChannelItem = { id?: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } };
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
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};

type MemeErrorCode = "MEME_TREND_KEY_MISSING" | "MEME_TREND_QUOTA_EXCEEDED" | "MEME_TREND_LOCAL_LIMIT_REACHED" | "MEME_TREND_SOURCE_FAILED" | "MEME_TREND_STORE_UNREADABLE";
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
    const key = normalizeName(core);
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

function normalizeName(value: string): string { return value.toLocaleLowerCase("ko-KR").replace(/[#\s_\-]+/gu, ""); }

function isGenericTrend(trend: MemeTrend): boolean {
  return GENERIC_NAMES.has(normalizeName(trend.id));
}

function shortVideo(item: YoutubeVideoItem): boolean {
  const match = /^PT(?:(\d+)M)?(?:(\d+)S)?$/u.exec(item.contentDetails?.duration ?? "");
  if (!match) return false;
  const seconds = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return seconds > 0 && seconds < 240;
}

function toTrendVideo(item: YoutubeVideoItem, observedAt: string, previous?: MemeTrendVideo, subscribers?: number | null): MemeTrendVideo | null {
  const id = item.id;
  const snippet = item.snippet;
  if (!id || !/^[\w-]{11}$/u.test(id) || !snippet?.title || !snippet.channelId || !snippet.publishedAt || !shortVideo(item)) return null;
  const age = Date.parse(observedAt) - Date.parse(snippet.publishedAt);
  if (!Number.isFinite(age) || age < 0 || age > SEARCH_DAYS * 86_400_000) return null;
  const rawViews = item.statistics?.viewCount;
  const parsedViews = rawViews === undefined ? null : Number(rawViews);
  const viewCount = parsedViews !== null && Number.isSafeInteger(parsedViews) && parsedViews >= 0 ? parsedViews : null;
  const countOrNull = (raw: string | undefined): number | null => {
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const thumbnail = snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? null;
  const thumbnailUrl = thumbnail && /^https:\/\/i.ytimg.com\//u.test(thumbnail) ? thumbnail : null;
  // Keep the earliest recent anchor across quick refreshes; otherwise repeated clicks
  // would always reset the 24-hour observation window before it could mature.
  const previousCount = previous?.viewCount;
  const oldAnchorAt = previous?.previousViewCountObservedAt;
  const oldAnchorCount = previous?.previousViewCount;
  const oldAnchorAge = oldAnchorAt ? Date.parse(observedAt) - Date.parse(oldAnchorAt) : NaN;
  const keepOldAnchor = oldAnchorCount !== undefined && oldAnchorAt !== undefined
    && Number.isFinite(oldAnchorAge) && oldAnchorAge > 0 && oldAnchorAge < MEME_GROWTH_MAX_INTERVAL_MS
    && previousCount !== null && previousCount !== undefined && oldAnchorCount <= previousCount;
  const anchorCount = keepOldAnchor ? oldAnchorCount : previousCount;
  const anchorAt = keepOldAnchor ? oldAnchorAt : previous?.viewCountObservedAt;
  const anchorAge = anchorAt ? Date.parse(observedAt) - Date.parse(anchorAt) : NaN;
  const validAnchor = viewCount !== null && anchorCount !== null && anchorCount !== undefined && anchorAt !== undefined
    && Number.isFinite(anchorAge) && anchorAge > 0 && anchorAge < MEME_GROWTH_MAX_INTERVAL_MS
    && viewCount >= anchorCount && (previousCount === null || previousCount === undefined || viewCount >= previousCount);
  return {
    videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title: snippet.title,
    channelId: snippet.channelId, channelTitle: snippet.channelTitle ?? snippet.channelId,
    publishedAt: snippet.publishedAt, thumbnailUrl, viewCount, viewCountObservedAt: observedAt,
    likeCount: countOrNull(item.statistics?.likeCount), commentCount: countOrNull(item.statistics?.commentCount),
    channelSubscriberCount: subscribers ?? null,
    ...(validAnchor ? { previousViewCount: anchorCount, previousViewCountObservedAt: anchorAt } : {}),
  };
}

type Discovery = { sources?: Map<string, Set<"search" | "popular" | "music-chart">>; songs?: Map<string, Array<{ title: string; regionCode: "KR" | "US" | "JP"; chartVideoId: string }>>; subscribers?: Map<string, number | null>; protectedIds?: Set<string> };

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
}

function thirdCreatorViews(videos: MemeTrendVideo[]): number {
  const best = new Map<string, number>();
  for (const video of videos) best.set(video.channelId, Math.max(best.get(video.channelId) ?? 0, video.viewCount ?? 0));
  return [...best.values()].sort((a, b) => b - a)[MEME_TREND_MIN_CHANNELS - 1] ?? 0;
}

/** Metadata overlap indicates a possible shared pattern, not proof of a shared gesture. */
export function groupMemeCandidates(items: YoutubeVideoItem[], observedAt: string, previous: MemeTrend[] = [], discovery: Discovery = {}): MemeTrend[] {
  const priorById = new Map(previous.map((trend) => [trend.id, trend]));
  const priorVideoById = new Map(previous.flatMap((trend) => trend.videos.map((video) => [video.videoId, video] as const)));
  const groups = new Map<string, { videos: Map<string, MemeTrendVideo>; evidence: Map<string, MemeTrendEvidence> }>();
  const seenVideoIds = new Set<string>();
  for (const item of items) {
    const id = item.id;
    const video = toTrendVideo(item, observedAt, id ? priorVideoById.get(id) : undefined, discovery.subscribers?.get(item.snippet?.channelId ?? ""));
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
  type Cluster = { ids: Set<string>; videos: Map<string, MemeTrendVideo>; evidence: Map<string, MemeTrendEvidence> };
  const clusters: Cluster[] = [...groups.entries()]
    .filter(([, group]) => group.videos.size >= MEME_TREND_MIN_VIDEOS
      && new Set([...group.videos.values()].map((video) => video.channelId)).size >= MEME_TREND_MIN_CHANNELS)
    .map(([id, group]) => ({ ids: new Set([id]), videos: group.videos, evidence: group.evidence }));
  clusters.sort((a, b) => b.videos.size - a.videos.size || [...a.ids][0]!.localeCompare([...b.ids][0]!));
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length;) {
      const a = clusters[i]!; const b = clusters[j]!;
      const overlap = [...b.videos.keys()].filter((id) => a.videos.has(id)).length;
      const bothSaved = [...a.ids].some((id) => discovery.protectedIds?.has(id)) && [...b.ids].some((id) => discovery.protectedIds?.has(id));
      if (bothSaved || overlap * 2 < Math.min(a.videos.size, b.videos.size)) { j++; continue; }
      for (const id of b.ids) a.ids.add(id);
      for (const [id, video] of b.videos) a.videos.set(id, video);
      for (const [key, evidence] of b.evidence) {
        const prior = a.evidence.get(key);
        a.evidence.set(key, prior ? { ...prior, videoCount: prior.videoCount + evidence.videoCount } : evidence);
      }
      clusters.splice(j, 1);
    }
  }
  const recentSince = Date.parse(observedAt) - RECENT_MS;
  return clusters.flatMap((group): MemeTrend[] => {
    const ids = [...group.ids];
    const savedId = ids.find((id) => discovery.protectedIds?.has(id));
    const id = savedId ?? ids[0]!;
    const videos = [...group.videos.values()].sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
    const channelCount = new Set(videos.map((video) => video.channelId)).size;
    if (videos.length < MEME_TREND_MIN_VIDEOS || channelCount < MEME_TREND_MIN_CHANNELS || thirdCreatorViews(videos) < MEME_TREND_MIN_THIRD_CREATOR_VIEWS) return [];
    const evidence = [...group.evidence.values()].sort((a, b) => b.videoCount - a.videoCount || a.text.localeCompare(b.text, "ko"));
    const bestPerChannel = new Map<string, MemeTrendVideo>();
    for (const video of videos) if (!bestPerChannel.has(video.channelId)) bestPerChannel.set(video.channelId, video);
    const representative = [...bestPerChannel.values()];
    const speeds = representative.flatMap((video) => {
      const growth = memeVideoGrowth(video);
      const speed = growth ? Math.round(growth.viewsPerDay / 24) : memeVideoAgeAverageViewsPerHour(video);
      return speed === null ? [] : [speed];
    });
    const ratios = representative.flatMap((video) => video.viewCount === null || video.channelSubscriberCount === null || video.channelSubscriberCount === undefined ? [] : [video.viewCount / Math.max(video.channelSubscriberCount, 1_000)]);
    const sources = new Set<"search" | "popular" | "music-chart">();
    const songs = new Map<string, { title: string; regionCode: "KR" | "US" | "JP"; chartVideoId: string }>();
    for (const video of videos) {
      for (const source of discovery.sources?.get(video.videoId) ?? []) sources.add(source);
      for (const song of discovery.songs?.get(video.videoId) ?? []) songs.set(song.chartVideoId, song);
    }
    for (const oldId of ids) for (const alias of priorById.get(oldId)?.aliases ?? []) if (alias !== id) group.ids.add(alias);
    const firstObservedAt = ids.map((oldId) => priorById.get(oldId)?.firstObservedAt).filter((date): date is string => !!date).sort()[0] ?? observedAt;
    return [{ id, aliases: [...group.ids].filter((alias) => alias !== id), name: evidence[0]!.text.replace(/^#/u, ""), evidence, videos, channelCount,
      firstObservedAt, lastObservedAt: observedAt,
      recentChannelCount: new Set(videos.filter((video) => Date.parse(video.publishedAt) >= recentSince).map((video) => video.channelId)).size,
      medianViewsPerHour: median(speeds), medianViewsPerSubscriber: median(ratios),
      discoverySources: [...sources], songs: [...songs.values()],
    }];
  }).sort((a, b) => (b.recentChannelCount ?? 0) - (a.recentChannelCount ?? 0)
    || (b.medianViewsPerHour ?? -1) - (a.medianViewsPerHour ?? -1)
    || (b.medianViewsPerSubscriber ?? -1) - (a.medianViewsPerSubscriber ?? -1)
    || thirdCreatorViews(b.videos) - thirdCreatorViews(a.videos)
    || b.videos.reduce((sum, video) => sum + (video.viewCount ?? 0), 0) - a.videos.reduce((sum, video) => sum + (video.viewCount ?? 0), 0)
    || b.channelCount - a.channelCount).slice(0, 12);
}

export class MemeTrendsService {
  private readonly cachePath: string;
  private readonly usagePath: string;
  private refreshInFlight: Promise<MemeTrendFeedResponse> | null = null;

  constructor(root: string, private readonly settings: ProviderSettingsService, private readonly fetchImpl: typeof fetch = globalThis.fetch, private readonly now: () => Date = () => new Date()) {
    this.cachePath = path.join(root, "meme_trends_youtube.json");
    this.usagePath = path.join(root, "meme_trend_refresh_usage.json");
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
    await this.reserveRefresh();
    const discovery = await this.fetchVideos(key);
    let protectedIds = new Set<string>();
    try {
      const saved: unknown = JSON.parse(await fs.readFile(path.join(path.dirname(this.cachePath), "meme_observation_workspaces.json"), "utf8"));
      if (saved && typeof saved === "object" && !Array.isArray(saved)) protectedIds = new Set(Object.keys(saved));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // An unreadable observation store must not cause a refresh to merge its old IDs.
        protectedIds = new Set(previous.trends.flatMap((trend) => [trend.id, ...(trend.aliases ?? [])]));
      }
    }
    const observedAt = this.now().toISOString();
    const next: MemeTrendFeedResponse = { source: "youtube", regionCode: "KR", collectedAt: observedAt,
      trends: groupMemeCandidates(discovery.items, observedAt, previous.trends, { ...discovery, protectedIds }) };
    try {
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      await atomicWriteUtf8File(this.cachePath, JSON.stringify(next));
    } catch { throw memeError("MEME_TREND_STORE_UNREADABLE", "밈 후보 저장 파일을 쓸 수 없습니다. meme_trends_youtube.json을 확인해 주세요.", HttpStatus.INTERNAL_SERVER_ERROR); }
    return next;
  }

  private async reserveRefresh(): Promise<void> {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(this.now());
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    let used = 0;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.usagePath, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof (raw as { day?: unknown }).day !== "string"
        || !Number.isSafeInteger((raw as { used?: unknown }).used) || (raw as { used: number }).used < 0) throw new Error("invalid usage");
      if ((raw as { day: string }).day === day) used = (raw as { used: number }).used;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw memeError("MEME_TREND_STORE_UNREADABLE", "밈 수집 횟수 파일을 읽을 수 없습니다. meme_trend_refresh_usage.json을 확인해 주세요.", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    if (used >= MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY) throw memeError("MEME_TREND_LOCAL_LIMIT_REACHED", "오늘 밈 후보 수집 4회 한도에 도달했습니다. YouTube 일일 할당량이 초기화된 뒤 다시 모아 주세요.", HttpStatus.TOO_MANY_REQUESTS);
    try {
      await fs.mkdir(path.dirname(this.usagePath), { recursive: true });
      await atomicWriteUtf8File(this.usagePath, JSON.stringify({ day, used: used + 1 }));
    } catch { throw memeError("MEME_TREND_STORE_UNREADABLE", "밈 수집 횟수를 저장할 수 없어 YouTube에 요청하지 않았습니다.", HttpStatus.INTERNAL_SERVER_ERROR); }
  }

  private async readCache(): Promise<MemeTrendFeedResponse> {
    try {
      const data: unknown = JSON.parse(await fs.readFile(this.cachePath, "utf8"));
      if (!isMemeTrendFeedResponse(data)) throw new Error("invalid cache");
      if (data.collectedAt && this.now().getTime() - Date.parse(data.collectedAt) >= CACHE_MAX_AGE_MS) {
        await fs.unlink(this.cachePath);
        return { source: "youtube", regionCode: "KR", collectedAt: null, trends: [] };
      }
      // Old cached feeds can still contain broad tags until the next explicit refresh.
      // Hide only known generic names; do not rewrite the person's saved feed on a read.
      return { ...data, trends: data.trends.filter((trend) => !isGenericTrend(trend)) };
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

  private async fetchVideos(key: string): Promise<Discovery & { items: YoutubeVideoItem[] }> {
    const now = this.now().getTime();
    const searches = [
      { order: "viewCount", publishedAfter: new Date(now - SEARCH_DAYS * 86_400_000).toISOString() },
      { order: "date", publishedAfter: new Date(now - RECENT_SEARCH_DAYS * 86_400_000).toISOString() },
    ];
    const ids = new Set<string>();
    const sources = new Map<string, Set<"search" | "popular" | "music-chart">>();
    const songs = new Map<string, Array<{ title: string; regionCode: "KR" | "US" | "JP"; chartVideoId: string }>>();
    const add = (videoId: string, source: "search" | "popular" | "music-chart", song?: { title: string; regionCode: "KR" | "US" | "JP"; chartVideoId: string }) => {
      ids.add(videoId);
      const found = sources.get(videoId) ?? new Set(); found.add(source); sources.set(videoId, found);
      if (song) songs.set(videoId, [...(songs.get(videoId) ?? []), song]);
    };
    const searchRegions = [
      { regionCode: "KR", relevanceLanguage: "ko", terms: [...SEARCH_TERMS, "댄스 챌린지"] },
      { regionCode: "US", relevanceLanguage: "en", terms: ["meme challenge", "dance challenge"] },
      { regionCode: "JP", relevanceLanguage: "ja", terms: ["ミーム チャレンジ", "ダンス チャレンジ"] },
    ] as const;
    for (const region of searchRegions) {
      for (const q of region.terms) for (const search of searches) {
        const result = await this.request("search", key, { part: "snippet", type: "video", regionCode: region.regionCode, relevanceLanguage: region.relevanceLanguage, videoDuration: "short", maxResults: "50", q, ...search });
        for (const item of apiItems<YoutubeSearchItem>(result)) if (item.id?.videoId) add(item.id.videoId, "search");
      }
    }
    // Music charts supply song names for bounded short-video searches; chart views are not challenge evidence.
    for (const regionCode of ["KR", "US", "JP"] as const) {
      const chart = await this.request("videos", key, { part: "snippet", chart: "mostPopular", videoCategoryId: "10", regionCode, maxResults: "10" });
      const chosen = new Set<string>();
      for (const item of apiItems<YoutubeVideoItem>(chart)) {
        const title = item.snippet?.title?.split(/\s[-–—]\s/u).at(-1)?.replace(/\s*\([^)]*\)/gu, "").trim();
        if (!title || title.length < 3 || title.length > 50 || !item.id || chosen.has(normalizeName(title))) continue;
        chosen.add(normalizeName(title));
        const song = { title, regionCode, chartVideoId: item.id };
        const result = await this.request("search", key, { part: "snippet", type: "video", regionCode,
          relevanceLanguage: regionCode === "KR" ? "ko" : regionCode === "JP" ? "ja" : "en", videoDuration: "short",
          publishedAfter: new Date(now - SEARCH_DAYS * 86_400_000).toISOString(), maxResults: "50",
          q: `${title} ${regionCode === "KR" ? "챌린지" : regionCode === "JP" ? "チャレンジ" : "challenge"}` });
        for (const found of apiItems<YoutubeSearchItem>(result)) if (found.id?.videoId) add(found.id.videoId, "music-chart", song);
        if (chosen.size >= 2) break;
      }
    }
    const all: YoutubeVideoItem[] = [];
    const videoIds = [...ids];
    for (let offset = 0; offset < videoIds.length; offset += 50) {
      const result = await this.request("videos", key, { part: "snippet,statistics,contentDetails", id: videoIds.slice(offset, offset + 50).join(","), maxResults: "50" });
      all.push(...apiItems<YoutubeVideoItem>(result));
    }
    // The general chart is another discovery sample, not proof of a shared meme.
    const chart = await this.request("videos", key, {
      part: "snippet,statistics,contentDetails", chart: "mostPopular", regionCode: "KR", maxResults: "50",
    });
    const oldest = now - SEARCH_DAYS * 86_400_000;
    all.push(...apiItems<YoutubeVideoItem>(chart).filter((item) => {
      const published = Date.parse(item.snippet?.publishedAt ?? "");
      return Number.isFinite(published) && published >= oldest && published <= now;
    }).map((item) => { if (item.id) add(item.id, "popular"); return item; }));
    const channelIds = [...new Set(all.map((item) => item.snippet?.channelId).filter((id): id is string => !!id))];
    const subscribers = new Map<string, number | null>();
    for (let offset = 0; offset < channelIds.length; offset += 50) {
      const result = await this.request("channels", key, { part: "statistics", id: channelIds.slice(offset, offset + 50).join(","), maxResults: "50" });
      for (const item of apiItems<YoutubeChannelItem>(result)) {
        if (!item.id) continue;
        const raw = item.statistics?.subscriberCount;
        const count = raw === undefined ? NaN : Number(raw);
        subscribers.set(item.id, item.statistics?.hiddenSubscriberCount || !Number.isSafeInteger(count) || count < 0 ? null : count);
      }
    }
    return { items: all, sources, songs, subscribers };
  }
}
