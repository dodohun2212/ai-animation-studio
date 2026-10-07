/** Recent YouTube metadata yields candidates, not verified cross-platform trends or video-content analysis. */
export const MEME_TREND_MIN_VIDEOS = 3;
export const MEME_TREND_MIN_CHANNELS = 2;

export interface MemeTrendVideo {
  videoId: string;
  url: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string | null;
  viewCount: number | null;
  viewCountObservedAt: string;
  previousViewCount?: number;
  previousViewCountObservedAt?: string;
}

export interface MemeTrendEvidence {
  kind: "hashtag" | "phrase";
  text: string;
  videoCount: number;
}

export interface MemeTrend {
  id: string;
  name: string;
  evidence: MemeTrendEvidence[];
  videos: MemeTrendVideo[];
  channelCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface MemeTrendFeedResponse {
  source: "youtube";
  regionCode: "KR";
  collectedAt: string | null;
  trends: MemeTrend[];
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function isMemeTrendVideo(value: unknown): value is MemeTrendVideo {
  if (!record(value)) return false;
  return typeof value.videoId === "string" && typeof value.url === "string" && typeof value.title === "string"
    && typeof value.channelId === "string" && typeof value.channelTitle === "string" && iso(value.publishedAt)
    && (value.thumbnailUrl === null || typeof value.thumbnailUrl === "string")
    && (value.viewCount === null || count(value.viewCount)) && iso(value.viewCountObservedAt)
    && (value.previousViewCount === undefined || count(value.previousViewCount))
    && (value.previousViewCountObservedAt === undefined || iso(value.previousViewCountObservedAt))
    && (value.previousViewCount === undefined) === (value.previousViewCountObservedAt === undefined);
}

function isMemeTrend(value: unknown): value is MemeTrend {
  if (!record(value)) return false;
  return typeof value.id === "string" && typeof value.name === "string" && count(value.channelCount)
    && iso(value.firstObservedAt) && iso(value.lastObservedAt)
    && Array.isArray(value.evidence) && value.evidence.length > 0
    && value.evidence.every((item: unknown) => record(item) && (item.kind === "hashtag" || item.kind === "phrase") && typeof item.text === "string" && count(item.videoCount))
    && Array.isArray(value.videos) && value.videos.length > 0 && value.videos.every(isMemeTrendVideo);
}

export function isMemeTrendFeedResponse(value: unknown): value is MemeTrendFeedResponse {
  return record(value) && value.source === "youtube" && value.regionCode === "KR"
    && (value.collectedAt === null || iso(value.collectedAt))
    && Array.isArray(value.trends) && value.trends.every(isMemeTrend);
}
