import {
  API_ROUTES,
  isMemeTrendFeedResponse,
  type MemeTrendFeedResponse,
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

  constructor(code: string, message: string) {
    super(message);
    this.name = "MemeTrendsApiError";
    this.code = code;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  MEME_TREND_KEY_MISSING: "YouTube Data API 키가 없습니다. API 설정의 YouTube 칸에 키를 넣은 뒤 다시 모아 주세요.",
  MEME_TREND_QUOTA_EXCEEDED: "YouTube API 할당량이 끝났습니다. 다시 눌러도 같은 결과이니 구글 클라우드 콘솔에서 할당량 재설정 시각을 확인한 뒤 다시 모아 주세요.",
  MEME_TREND_SOURCE_FAILED: "YouTube에서 밈 후보를 가져오지 못했습니다. 연결과 키의 YouTube Data API 활성화 상태를 확인한 뒤 다시 모아 주세요.",
  MEME_TREND_STORE_UNREADABLE: "밈 후보 저장 파일을 읽거나 쓰지 못했습니다. 다시 눌러도 같은 결과이니 meme_trends_youtube.json 을 확인해 주세요.",
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

async function requestFeed(url: string, init?: RequestInit): Promise<MemeTrendFeedResponse> {
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
    throw new MemeTrendsApiError(carriedCode, "");
  }
  if (!isMemeTrendFeedResponse(body)) throw new MemeTrendsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

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
