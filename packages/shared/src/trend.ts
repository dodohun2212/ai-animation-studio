/** Recent YouTube metadata yields candidates, not verified cross-platform trends or video-content analysis. */
export const MEME_TREND_MIN_VIDEOS = 3;
export const MEME_TREND_MIN_CHANNELS = 3;
export const MEME_TREND_MIN_THIRD_CREATOR_VIEWS = 3_000;
export const MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY = 4;
export const MEME_GROWTH_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MEME_GROWTH_MAX_INTERVAL_MS = 30 * MEME_GROWTH_MIN_INTERVAL_MS;
export const MEME_ANALYSIS_SOURCE_LIMIT = 3;

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
  likeCount?: number | null;
  commentCount?: number | null;
  channelSubscriberCount?: number | null;
  previousViewCount?: number;
  previousViewCountObservedAt?: string;
}

/** Observed average over the stated interval, never a prediction or an estimated current rate. */
export function memeVideoGrowth(video: MemeTrendVideo): { viewsGained: number; viewsPerDay: number } | null {
  if (video.viewCount === null || video.previousViewCount === undefined || video.previousViewCountObservedAt === undefined) return null;
  const elapsedMs = Date.parse(video.viewCountObservedAt) - Date.parse(video.previousViewCountObservedAt);
  const viewsGained = video.viewCount - video.previousViewCount;
  if (!Number.isFinite(elapsedMs) || elapsedMs < MEME_GROWTH_MIN_INTERVAL_MS || elapsedMs >= MEME_GROWTH_MAX_INTERVAL_MS || viewsGained < 0) return null;
  return { viewsGained, viewsPerDay: Math.round(viewsGained / elapsedMs * MEME_GROWTH_MIN_INTERVAL_MS) };
}

export interface MemeTrendEvidence {
  kind: "hashtag" | "phrase";
  text: string;
  videoCount: number;
}

export interface MemeTrend {
  id: string;
  /** Old candidate IDs that resolve to this candidate after overlapping evidence is merged. */
  aliases?: string[];
  name: string;
  evidence: MemeTrendEvidence[];
  videos: MemeTrendVideo[];
  channelCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  recentChannelCount?: number;
  medianViewsPerHour?: number | null;
  medianViewsPerSubscriber?: number | null;
  discoverySources?: Array<"search" | "popular" | "music-chart">;
  songs?: Array<{ title: string; regionCode: "KR" | "US" | "JP"; chartVideoId: string }>;
}

/** Publish-to-observation average, distinct from the measured repeat-observation growth. */
export function memeVideoAgeAverageViewsPerHour(video: MemeTrendVideo): number | null {
  if (video.viewCount === null) return null;
  const ageHours = (Date.parse(video.viewCountObservedAt) - Date.parse(video.publishedAt)) / 3_600_000;
  return Number.isFinite(ageHours) && ageHours >= 0 ? Math.round(video.viewCount / Math.max(ageHours, 6)) : null;
}

export interface MemeTrendFeedResponse {
  source: "youtube";
  regionCode: "KR";
  collectedAt: string | null;
  trends: MemeTrend[];
}

export const MEME_OBSERVATION_KINDS = ["line", "gesture", "timing"] as const;
export type MemeObservationKind = (typeof MEME_OBSERVATION_KINDS)[number];
export const MEME_OBSERVATION_LIMITS = { textMax: 200, cardsMax: 20, secondsMax: 600 } as const;

interface MemeObservationBase {
  kind: MemeObservationKind;
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
}

export interface MemeAnalysisSuggestion extends MemeObservationBase { id: string }
export interface MemeTrendAnalysis {
  sourceVideoId: string;
  provider: "gemini";
  model: string;
  analyzedAt: string;
  suggestions: MemeAnalysisSuggestion[];
}
export interface MemeObservationCard extends MemeObservationBase {
  id: string;
  origin: "suggestion" | "manual";
  suggestionId?: string;
  sourceVideoId: string | null;
}
export interface MemeAnalysisDailyCalls { used: number; limit: number }
export interface MemeTrendWorkspace {
  trendId: string;
  analyses: MemeTrendAnalysis[];
  cards: MemeObservationCard[];
  cardsSavedAt: string | null;
  dailyCalls: MemeAnalysisDailyCalls | null;
}
export interface AnalyzeMemeVideoRequest { sourceVideoId: string }
export interface SaveMemeObservationCardsRequest {
  cards: Array<Omit<MemeObservationCard, "id"> & { id?: string }>;
  expectedCardsSavedAt: string | null;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const observationBase = (value: unknown): value is MemeObservationBase => record(value)
  && MEME_OBSERVATION_KINDS.some((kind) => kind === value.kind)
  && typeof value.text === "string" && value.text.trim().length > 0 && value.text.length <= MEME_OBSERVATION_LIMITS.textMax
  && (value.startSeconds === null || (typeof value.startSeconds === "number" && Number.isFinite(value.startSeconds) && value.startSeconds >= 0 && value.startSeconds <= MEME_OBSERVATION_LIMITS.secondsMax && Math.round(value.startSeconds * 10) === value.startSeconds * 10))
  && (value.endSeconds === null || (typeof value.endSeconds === "number" && Number.isFinite(value.endSeconds) && value.endSeconds >= 0 && value.endSeconds <= MEME_OBSERVATION_LIMITS.secondsMax && Math.round(value.endSeconds * 10) === value.endSeconds * 10))
  && (value.startSeconds === null || value.endSeconds === null || value.endSeconds >= value.startSeconds);

export function isMemeTrendWorkspace(value: unknown): value is MemeTrendWorkspace {
  if (!record(value)) return false;
  return typeof value.trendId === "string"
    && Array.isArray(value.analyses) && value.analyses.length <= MEME_ANALYSIS_SOURCE_LIMIT
    && value.analyses.every((analysis: unknown) => record(analysis) && typeof analysis.sourceVideoId === "string"
      && analysis.provider === "gemini" && typeof analysis.model === "string" && iso(analysis.analyzedAt)
      && Array.isArray(analysis.suggestions) && analysis.suggestions.length <= MEME_OBSERVATION_LIMITS.cardsMax
      && analysis.suggestions.every((item: unknown) => record(item) && observationBase(item) && typeof item.id === "string"))
    && new Set(value.analyses.map((analysis) => record(analysis) ? analysis.sourceVideoId : null)).size === value.analyses.length
    && Array.isArray(value.cards) && value.cards.length <= MEME_OBSERVATION_LIMITS.cardsMax
    && value.cards.every((item: unknown) => record(item) && observationBase(item) && typeof item.id === "string" && (item.origin === "manual" || item.origin === "suggestion")
      && (item.sourceVideoId === null || typeof item.sourceVideoId === "string") && (item.suggestionId === undefined || typeof item.suggestionId === "string"))
    && (value.cardsSavedAt === null || iso(value.cardsSavedAt))
    && (value.dailyCalls === null || (record(value.dailyCalls) && count(value.dailyCalls.used) && count(value.dailyCalls.limit)));
}

function isMemeTrendVideo(value: unknown): value is MemeTrendVideo {
  if (!record(value)) return false;
  return typeof value.videoId === "string" && typeof value.url === "string" && typeof value.title === "string"
    && typeof value.channelId === "string" && typeof value.channelTitle === "string" && iso(value.publishedAt)
    && (value.thumbnailUrl === null || typeof value.thumbnailUrl === "string")
    && (value.viewCount === null || count(value.viewCount)) && iso(value.viewCountObservedAt)
    && (value.likeCount === undefined || value.likeCount === null || count(value.likeCount))
    && (value.commentCount === undefined || value.commentCount === null || count(value.commentCount))
    && (value.channelSubscriberCount === undefined || value.channelSubscriberCount === null || count(value.channelSubscriberCount))
    && (value.previousViewCount === undefined || count(value.previousViewCount))
    && (value.previousViewCountObservedAt === undefined || iso(value.previousViewCountObservedAt))
    && (value.previousViewCount === undefined) === (value.previousViewCountObservedAt === undefined);
}

function isMemeTrend(value: unknown): value is MemeTrend {
  if (!record(value)) return false;
  return typeof value.id === "string" && typeof value.name === "string" && count(value.channelCount)
    && (value.aliases === undefined || (Array.isArray(value.aliases) && value.aliases.every((id: unknown) => typeof id === "string")))
    && (value.recentChannelCount === undefined || count(value.recentChannelCount))
    && (value.medianViewsPerHour === undefined || value.medianViewsPerHour === null || count(value.medianViewsPerHour))
    && (value.medianViewsPerSubscriber === undefined || value.medianViewsPerSubscriber === null || (typeof value.medianViewsPerSubscriber === "number" && Number.isFinite(value.medianViewsPerSubscriber) && value.medianViewsPerSubscriber >= 0))
    && (value.discoverySources === undefined || (Array.isArray(value.discoverySources) && value.discoverySources.every((source: unknown) => source === "search" || source === "popular" || source === "music-chart")))
    && (value.songs === undefined || (Array.isArray(value.songs) && value.songs.every((song: unknown) => record(song) && typeof song.title === "string" && (song.regionCode === "KR" || song.regionCode === "US" || song.regionCode === "JP") && typeof song.chartVideoId === "string")))
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
