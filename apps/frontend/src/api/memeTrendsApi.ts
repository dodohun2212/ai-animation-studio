import {
  API_ROUTES,
  MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY,
  isMemeTrendFeedResponse,
  isMemeTrendWorkspace,
  type AnalyzeMemeVideoRequest,
  type MemeAnalysisDailyCalls,
  type MemeTrendFeedResponse,
  type MemeTrendWorkspace,
  type SaveMemeObservationCardsRequest,
} from "@ai-animation-studio/shared";

import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

/**
 * 밈 후보 목록 — YouTube 공식 API 로 모은 것을 **읽기만** 하는 길과, **다시 모으는** 길.
 *
 * 🔴 둘을 갈라 둔 이유: 읽기(`GET`)는 서버에 저장된 마지막 수집 결과만 돌려주고 YouTube 를 부르지 않습니다.
 * 화면을 열 때마다 검색 할당량이 줄면, 사람은 「보기만 했는데 할당량이 왜 줄었지」를 알 길이 없습니다.
 * 할당량을 쓰는 건 「YouTube에서 다시 모으기」를 누를 때 한 번뿐입니다.
 *
 * 🟠 오류 문장은 코드마다 따로입니다 — 각각 **다음에 할 일이 다릅니다.** 키가 없으면 API 설정으로, 할당량이
 * 끝났으면 재설정 시각까지(구글 기준 태평양 시간 자정이라 한국의 「내일」과 맞지 않습니다 — CLI Round 1271), 연결이 끊겼으면 다시 누르기, 저장 파일을 못 읽으면 그 파일을 열어 보기. 한 문장으로
 * 합치면 그 넷 중 셋은 틀린 조언이 됩니다.
 */
export class MemeTrendsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "MemeTrendsApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  MEME_TREND_KEY_MISSING: "YouTube Data API 키가 없습니다. API 설정의 YouTube 칸에 키를 넣은 뒤 다시 모아 주세요.",
  // CLI 1356·1358: 수동 수집도 하루(미국 태평양 날짜) N회까지(shared 상수) — 앱 장부가 먼저 막으므로 이때는 YouTube 요청이 나가지 않았습니다.
  MEME_TREND_LOCAL_LIMIT_REACHED: `오늘 밈 후보 수집 ${MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY}회 한도에 도달했습니다. 이 앱이 막은 것이라 YouTube에는 요청하지 않았습니다. YouTube 일일 할당량이 초기화된 뒤(미국 태평양 시간 자정) 다시 모아 주세요. 아래는 지난번에 모은 목록입니다.`,
  MEME_TREND_QUOTA_EXCEEDED: "YouTube API 할당량이 끝났습니다. 다시 눌러도 같은 결과이니 구글 클라우드 콘솔에서 할당량 재설정 시각을 확인한 뒤 다시 모아 주세요.",
  MEME_TREND_SOURCE_FAILED: "YouTube에서 밈 후보를 가져오지 못했습니다. 연결과 키의 YouTube Data API 활성화 상태를 확인한 뒤 다시 모아 주세요.",
  MEME_TREND_STORE_UNREADABLE: "밈 후보 저장 파일을 읽거나 쓰지 못했습니다. 다시 눌러도 같은 결과이니 meme_trends_youtube.json 을 확인해 주세요.",
  // ② 관찰 카드(CLI Round 1280). 분석이 막혀도 카드는 직접 적을 수 있어서, 막힌 경우의 문장은 그 길로 끝납니다.
  MEME_ANALYSIS_KEY_MISSING: "영상 분석에 쓸 Gemini 키가 없습니다. API 설정의 Gemini 칸에 키를 넣거나, 아래에서 카드를 직접 적을 수 있습니다.",
  MEME_ANALYSIS_DAILY_LIMIT_REACHED: "오늘 쓸 수 있는 영상 분석 횟수를 다 썼습니다. 이 앱이 막고 있는 것이고, 아래에서 카드를 직접 적을 수 있습니다.",
  MEME_ANALYSIS_LEDGER_UNREADABLE: "분석 사용 기록 파일을 읽을 수 없어 오늘 쓴 횟수를 확인하지 못했습니다. 확인하기 전에는 분석을 부르지 않습니다. meme_analysis_call_usage.json 을 확인해 주세요.",
  MEME_ANALYSIS_FAILED: "영상 분석 결과를 받지 못했습니다. 요청은 나갔으므로 오늘 횟수가 한 번 줄었습니다. 저장된 제안과 카드는 그대로이고, 아래에서 직접 적을 수 있습니다.",
  MEME_ANALYSIS_VIDEO_NOT_IN_TREND: "고른 영상이 이 후보의 목록에 없습니다. 목록을 다시 불러온 뒤 골라 주세요.",
  // 출처 비교(CLI 1340) — 셋 다 서버가 Gemini 를 부르기 전에 막는 것이라 횟수는 줄지 않습니다.
  MEME_ANALYSIS_CHANNEL_ALREADY_USED: "이 제작자의 영상은 이미 분석했습니다. 다른 제작자의 영상을 골라 주세요. 요청은 보내지 않았고 오늘 횟수도 그대로입니다.",
  MEME_ANALYSIS_SOURCE_UNKNOWN: "전에 분석한 영상이 지금 후보 목록에서 빠져, 제작자가 겹치는지 확인할 수 없어 보내지 않았습니다. 저장된 제안은 그대로 쓸 수 있고 오늘 횟수도 그대로입니다.",
  MEME_ANALYSIS_SOURCE_LIMIT: "이 밈은 서로 다른 제작자의 영상 3편까지 분석할 수 있어 새 영상은 보내지 않았습니다. 이미 분석한 영상을 다시 분석할 수는 있습니다. 오늘 횟수는 그대로입니다.",
  MEME_TREND_UNKNOWN: "이 밈 후보는 지금 목록에 없어 카드를 열 수 없습니다. 같은 후보가 다시 모이면 저장한 카드가 다시 열립니다.",
  MEME_CARDS_INVALID: "카드 내용이 저장 조건에 맞지 않습니다. 빈 글자, 너무 긴 글자, 시작보다 앞선 끝 시간을 확인해 주세요.",
  MEME_CARDS_CONFLICT: "그사이 카드가 다른 곳에서 저장됐습니다. 입력하신 내용은 그대로 있습니다 — 다시 읽은 뒤 저장하면 이 내용으로 덮어씁니다.",
  MEME_WORKSPACE_STORE_UNREADABLE: "밈 카드 저장 파일을 읽거나 쓰지 못했습니다. 다시 눌러도 같은 결과이니 저장 폴더의 밈 작업 파일을 확인해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** 서버의 원문 대신 코드마다 정해 둔 문장만 보여 줍니다. */
export function toMemeTrendDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof MemeTrendsApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) return { code: error.code, message: SAFE_ERRORS[error.code]! };
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function requestJson<T>(url: string, init: RequestInit | undefined, guard: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new MemeTrendsApiError(NETWORK.code, NETWORK.message);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const carriedCode = isRecord(body) && typeof body.code === "string" && body.code.trim() ? body.code : MALFORMED.code;
    if (isServerUnavailable(response.status, carriedCode)) {
      throw new MemeTrendsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    throw new MemeTrendsApiError(carriedCode, "", isRecord(body) && isRecord(body.details) ? body.details : undefined);
  }
  if (!guard(body)) throw new MemeTrendsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

const requestFeed = (url: string, init?: RequestInit) => requestJson(url, init, isMemeTrendFeedResponse);

/** 마지막으로 모은 밈 후보. YouTube 를 부르지 않습니다 — 할당량을 쓰지 않습니다. */
export function getMemeTrends(): Promise<MemeTrendFeedResponse> {
  return requestFeed(API_ROUTES.memeTrends);
}

/**
 * YouTube 에서 다시 모읍니다 — **YouTube 검색 할당량을 씁니다.** 할당량은 프로젝트마다 다를 수 있어 남은 양을 말하지 않습니다.
 * 실패해도 서버는 지난 목록을 지우지 않으므로, 화면도 보고 있던 목록을 그대로 둡니다.
 */
export function refreshMemeTrends(): Promise<MemeTrendFeedResponse> {
  return requestFeed(API_ROUTES.memeTrendsRefresh, { method: "POST" });
}

/** 고른 후보의 저장된 분석·카드. **Gemini 를 부르지 않습니다** — 후보를 고를 때마다 이것만 읽습니다. */
export function getMemeTrendWorkspace(trendId: string): Promise<MemeTrendWorkspace> {
  return requestJson(API_ROUTES.memeTrendWorkspace(trendId), undefined, isMemeTrendWorkspace);
}

/**
 * 고른 영상 한 편을 Gemini 로 분석합니다 — **오늘 분석 횟수를 한 번 씁니다**(요청이 나간 뒤에는 실패해도).
 * 성공했을 때만 서버가 **그 영상의** 제안을 바꾸고(다른 출처의 분석은 그대로, 한 후보에 서로 다른 제작자 3편까지),
 * 사람이 저장한 카드는 어떤 경우에도 건드리지 않습니다.
 */
export function analyzeMemeVideo(trendId: string, request: AnalyzeMemeVideoRequest): Promise<MemeTrendWorkspace> {
  return requestJson(API_ROUTES.memeTrendAnalysis(trendId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, isMemeTrendWorkspace);
}

/** 사람의 카드를 저장합니다. 외부 호출 없음. `expectedCardsSavedAt` 이 서버와 다르면 409(`MEME_CARDS_CONFLICT`). */
export function saveMemeObservationCards(trendId: string, request: SaveMemeObservationCardsRequest): Promise<MemeTrendWorkspace> {
  return requestJson(API_ROUTES.memeTrendCards(trendId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, isMemeTrendWorkspace);
}

/** 분석 실패 응답이 실어 온 새 횟수(CLI Round 1280 — 요청이 나간 뒤 실패도 한 번 셉니다). 모양이 아니면 null. */
export function dailyCallsFromError(error: unknown): MemeAnalysisDailyCalls | null {
  if (!(error instanceof MemeTrendsApiError) || !error.details) return null;
  const calls = error.details.dailyCalls;
  if (!isRecord(calls)) return null;
  const { used, limit } = calls as { used?: unknown; limit?: unknown };
  return Number.isSafeInteger(used) && Number.isSafeInteger(limit) && (used as number) >= 0 && (limit as number) >= 0
    ? { used: used as number, limit: limit as number }
    : null;
}
