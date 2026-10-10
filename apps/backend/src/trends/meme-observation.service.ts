import * as fs from "node:fs/promises";
import * as path from "node:path";

import { HttpException, HttpStatus } from "@nestjs/common";
import { isMemeTrendWorkspace, MEME_ANALYSIS_SOURCE_LIMIT, type AnalyzeMemeVideoRequest, type ApiError, type MemeTrendAnalysis, type MemeTrendWorkspace, type SaveMemeObservationCardsRequest } from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { GEMINI_SUMMARY_MODEL } from "../news/gemini-summary-adapter.js";
import { MemeAnalysisQuota } from "./meme-analysis-quota.js";
import { MemeTrendsService } from "./meme-trends.service.js";
import { askGeminiAboutMemeVideo, MemeVideoProviderError } from "./gemini-meme-video.adapter.js";
import { parseMemeSuggestions, validateMemeCards } from "./meme-observation-parser.js";

const STORE_FILENAME = "meme_observation_workspaces.json";
type SavedWorkspace = Omit<MemeTrendWorkspace, "dailyCalls">;

function apiError(code: string, message: string, status: HttpStatus, details?: Record<string, unknown>): HttpException {
  return new HttpException({ code, message, ...(details ? { details } : {}) } satisfies ApiError, status);
}

export class MemeObservationService {
  private readonly filePath: string;
  private readonly quota: MemeAnalysisQuota;
  private pending: Promise<void> = Promise.resolve();
  private analysisPending: Promise<void> = Promise.resolve();

  constructor(root: string, private readonly trends: MemeTrendsService, private readonly settings: ProviderSettingsService,
    private readonly fetchImpl: typeof fetch = globalThis.fetch, private readonly now: () => Date = () => new Date()) {
    this.filePath = path.join(root, STORE_FILENAME);
    this.quota = new MemeAnalysisQuota(root, now);
  }

  private async trend(trendId: string) {
    const found = (await this.trends.get()).trends.find((item) => item.id === trendId);
    if (!found) throw apiError("MEME_TREND_UNKNOWN", "현재 밈 후보 목록에 없는 항목입니다. 목록을 다시 확인해 주세요.", HttpStatus.NOT_FOUND);
    return found;
  }

  private async readStore(): Promise<Record<string, SavedWorkspace>> {
    let raw: string;
    try { raw = await fs.readFile(this.filePath, "utf8"); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return Object.create(null) as Record<string, SavedWorkspace>;
      throw apiError("MEME_WORKSPACE_STORE_UNREADABLE", `${STORE_FILENAME} 파일을 읽을 수 없습니다.`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw apiError("MEME_WORKSPACE_STORE_UNREADABLE", `${STORE_FILENAME} 파일의 형식이 올바르지 않습니다.`, HttpStatus.INTERNAL_SERVER_ERROR); }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw apiError("MEME_WORKSPACE_STORE_UNREADABLE", `${STORE_FILENAME} 파일의 형식이 올바르지 않습니다.`, HttpStatus.INTERNAL_SERVER_ERROR);
    const workspaces = parsed as Record<string, unknown>;
    for (const [id, value] of Object.entries(workspaces)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw apiError("MEME_WORKSPACE_STORE_UNREADABLE", `${STORE_FILENAME} 파일의 형식이 올바르지 않습니다.`, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      const legacy = value as Record<string, unknown>;
      const analyses = Array.isArray(legacy.analyses) ? legacy.analyses : ("analysis" in legacy ? (legacy.analysis === null ? [] : [legacy.analysis]) : null);
      const normalized = { trendId: legacy.trendId, analyses, cards: legacy.cards, cardsSavedAt: legacy.cardsSavedAt };
      if (!isMemeTrendWorkspace({ ...normalized, dailyCalls: null }) || normalized.trendId !== id) {
        throw apiError("MEME_WORKSPACE_STORE_UNREADABLE", `${STORE_FILENAME} 파일의 형식이 올바르지 않습니다.`, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      workspaces[id] = normalized;
    }
    return workspaces as Record<string, SavedWorkspace>;
  }

  private async writeStore(store: Record<string, SavedWorkspace>): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await atomicWriteUtf8File(this.filePath, JSON.stringify(store));
    } catch { throw apiError("MEME_WORKSPACE_STORE_UNREADABLE", `${STORE_FILENAME} 파일을 쓸 수 없습니다.`, HttpStatus.INTERNAL_SERVER_ERROR); }
  }

  private empty(trendId: string): SavedWorkspace { return { trendId, analyses: [], cards: [], cardsSavedAt: null }; }
  private async dailyCalls(): Promise<MemeTrendWorkspace["dailyCalls"]> {
    try { return await this.quota.dailyCalls(); } catch { return null; }
  }

  async get(trendId: string): Promise<MemeTrendWorkspace> {
    await this.trend(trendId);
    return { ...((await this.readStore())[trendId] ?? this.empty(trendId)), dailyCalls: await this.dailyCalls() };
  }

  private async mutate<T>(change: (store: Record<string, SavedWorkspace>) => Promise<T>): Promise<T> {
    const before = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => { release = resolve; });
    await before;
    try { return await change(await this.readStore()); } finally { release(); }
  }

  async saveCards(trendId: string, body: SaveMemeObservationCardsRequest): Promise<MemeTrendWorkspace> {
    const trend = await this.trend(trendId);
    if (!body || (body.expectedCardsSavedAt !== null && typeof body.expectedCardsSavedAt !== "string")) {
      throw apiError("MEME_CARDS_INVALID", "카드 저장 요청이 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
    }
    let cards: SavedWorkspace["cards"];
    try { cards = validateMemeCards(body.cards); }
    catch { throw apiError("MEME_CARDS_INVALID", "카드는 20개 이하, 글은 200자 이하, 시간은 0~600초로 입력해 주세요.", HttpStatus.BAD_REQUEST); }
    if (new Set(cards.map((card) => card.id)).size !== cards.length) throw apiError("MEME_CARDS_INVALID", "카드 ID가 중복됐습니다.", HttpStatus.BAD_REQUEST);
    return this.mutate(async (store) => {
      const saved = store[trendId] ?? this.empty(trendId);
      if (saved.cardsSavedAt !== body.expectedCardsSavedAt) throw apiError("MEME_CARDS_CONFLICT", "다른 저장본이 있습니다. 목록을 다시 읽어 주세요.", HttpStatus.CONFLICT);
      // A saved source can age out of the refreshed feed; keep that user's card editable.
      const validVideoIds = new Set([...trend.videos.map((video) => video.videoId),
        ...saved.analyses.map((analysis) => analysis.sourceVideoId),
        ...saved.cards.flatMap((card) => card.sourceVideoId ? [card.sourceVideoId] : [])]);
      if (cards.some((card) => card.sourceVideoId && !validVideoIds.has(card.sourceVideoId))) {
        throw apiError("MEME_CARDS_INVALID", "카드의 출처 영상이 이 밈 후보에 없습니다.", HttpStatus.BAD_REQUEST);
      }
      const next = { ...saved, cards, cardsSavedAt: this.now().toISOString() };
      store[trendId] = next;
      await this.writeStore(store);
      return { ...next, dailyCalls: await this.dailyCalls() };
    });
  }

  async analyze(trendId: string, body: AnalyzeMemeVideoRequest): Promise<MemeTrendWorkspace> {
    const before = this.analysisPending;
    let release!: () => void;
    this.analysisPending = new Promise<void>((resolve) => { release = resolve; });
    await before;
    try { return await this.analyzeOnce(trendId, body); } finally { release(); }
  }

  private async analyzeOnce(trendId: string, body: AnalyzeMemeVideoRequest): Promise<MemeTrendWorkspace> {
    const trend = await this.trend(trendId);
    const videoId = body?.sourceVideoId;
    const sourceVideo = trend.videos.find((video) => video.videoId === videoId);
    if (typeof videoId !== "string" || !sourceVideo) {
      throw apiError("MEME_ANALYSIS_VIDEO_NOT_IN_TREND", "선택한 영상이 이 밈 후보에 없습니다. 목록을 다시 읽어 주세요.", HttpStatus.BAD_REQUEST);
    }
    const savedBeforeRequest = (await this.readStore())[trendId] ?? this.empty(trendId);
    const sameVideo = savedBeforeRequest.analyses.find((item) => item.sourceVideoId === videoId);
    const otherVideos = savedBeforeRequest.analyses.filter((item) => item.sourceVideoId !== videoId);
    const knownSourceVideos = otherVideos.map((item) => trend.videos.find((video) => video.videoId === item.sourceVideoId));
    if (!sameVideo && knownSourceVideos.some((video) => !video)) {
      throw apiError("MEME_ANALYSIS_SOURCE_UNKNOWN", "이전에 분석한 영상이 현재 후보 목록에서 빠져 제작자를 확인할 수 없습니다. 저장된 제안을 사용하거나 후보를 다시 모아 주세요.", HttpStatus.CONFLICT);
    }
    if (knownSourceVideos.some((video) => video?.channelId === sourceVideo.channelId)) {
      throw apiError("MEME_ANALYSIS_CHANNEL_ALREADY_USED", "이 제작자의 영상은 이미 분석했습니다. 다른 제작자의 대표 영상을 골라 주세요.", HttpStatus.CONFLICT);
    }
    if (!sameVideo && savedBeforeRequest.analyses.length >= MEME_ANALYSIS_SOURCE_LIMIT) {
      throw apiError("MEME_ANALYSIS_SOURCE_LIMIT", "이 밈은 서로 다른 제작자 영상 3편까지 분석할 수 있습니다.", HttpStatus.CONFLICT);
    }
    const key = await this.settings.rawCredentialIfConnected("gemini");
    if (!key) throw apiError("MEME_ANALYSIS_KEY_MISSING", "Gemini 키가 없습니다. API 설정에서 저장하거나 아래에서 직접 적을 수 있습니다.", HttpStatus.BAD_REQUEST);
    let dailyCalls: MemeTrendWorkspace["dailyCalls"];
    try { dailyCalls = await this.quota.reserve(); }
    catch (cause) {
      if ((cause as Error).message === "daily_limit") throw apiError("MEME_ANALYSIS_DAILY_LIMIT_REACHED", "밈 영상 분석의 오늘 3회 한도에 도달했습니다. 아래에서 직접 적을 수 있습니다.", HttpStatus.TOO_MANY_REQUESTS);
      throw apiError("MEME_ANALYSIS_LEDGER_UNREADABLE", "meme_analysis_call_usage.json을 읽거나 쓸 수 없어 분석을 보내지 않았습니다.", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    let analysis: MemeTrendAnalysis;
    try {
      const raw = await askGeminiAboutMemeVideo(videoId, key, this.fetchImpl);
      analysis = { sourceVideoId: videoId, provider: "gemini", model: GEMINI_SUMMARY_MODEL, analyzedAt: this.now().toISOString(), suggestions: parseMemeSuggestions(raw) };
    } catch (cause) {
      const reason = cause instanceof MemeVideoProviderError ? cause.failure : "invalid_response";
      throw apiError("MEME_ANALYSIS_FAILED", `Gemini 영상 분석에 실패했습니다 (${reason}). 오늘 1회를 사용했습니다. 아래에서 직접 적을 수 있습니다.`, HttpStatus.BAD_GATEWAY, { dailyCalls });
    }
    return this.mutate(async (store) => {
      const saved = store[trendId] ?? this.empty(trendId);
      const previous = saved.analyses.findIndex((item) => item.sourceVideoId === videoId);
      const analyses = [...saved.analyses];
      if (previous >= 0) analyses[previous] = analysis;
      else analyses.push(analysis);
      const next = { ...saved, analyses };
      store[trendId] = next;
      await this.writeStore(store);
      return { ...next, dailyCalls };
    });
  }
}
