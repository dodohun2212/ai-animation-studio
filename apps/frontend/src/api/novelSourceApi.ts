import {
  API_ROUTES,
  isNovelSourceImportResponse,
  isNovelSourceSearchResponse,
  type NovelSourceImportRequest,
  type NovelSourceImportResponse,
  type NovelSourceSearchRequest,
  type NovelSourceSearchResponse,
} from "@ai-animation-studio/shared";

import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

/**
 * 저작권이 끝난 소설 고르기(CLI 1345) — **검색**(목록만)과 **가져오기**(고른 한 편의 본문)를 갈라 둔 두 길.
 *
 * 🔴 둘 다 로컬 백엔드만 부르고, 백엔드가 Project Gutenberg(Gutendex 목록·공식 미러 원문)를 읽습니다. 유료 요청이 아니며
 * 사람이 「검색」·「길이 확인」·「이 범위 가져오기」를 누를 때만 나갑니다(자동·주기 수집 없음). 가져온 본문은 서버도 화면도
 * 저장하지 않습니다 — 화면의 입력 칸에만 있다가 분석 미리보기·승인 때 그대로 보내집니다.
 * 🟠 목록의 권리 필터(저자·번역자 사망 연도로 본 한국 보호기간)는 **법적 보증이 아니라** 보수적인 거르기이고, 화면이 그렇게 말합니다.
 */
export class NovelSourceApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NovelSourceApiError";
    this.code = code;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  NOVEL_SOURCE_INVALID_REQUEST: "검색어나 고른 장 범위가 조건에 맞지 않습니다. 제목·작가 또는 장르를 넣고, 장 범위는 처음 장이 끝 장보다 앞서게 골라 주세요.",
  NOVEL_SOURCE_NOT_FOUND: "고른 작품을 제공처에서 찾지 못했습니다. 목록이 바뀌었을 수 있으니 다시 검색한 뒤 골라 주세요.",
  NOVEL_SOURCE_CHAPTERS_UNAVAILABLE: "이 원문에서 장의 경계를 찾지 못해 범위를 나눌 수 없습니다. 다른 작품을 고르거나 본문을 직접 붙여넣어 주세요.",
  NOVEL_SOURCE_TEXT_INVALID: "가져온 원문에서 본문의 처음과 끝을 확인할 수 없습니다. 다른 작품을 고르거나 본문을 직접 붙여넣어 주세요.",
  NOVEL_SOURCE_TEXT_UNAVAILABLE: "고른 작품의 텍스트 파일을 Project Gutenberg에서 받지 못했습니다. 잠시 뒤 다시 확인하거나 다른 작품을 골라 주세요.",
  NOVEL_SOURCE_TEXT_TOO_LARGE: "작품 파일이 이 앱이 받는 크기보다 커서 가져오지 않았습니다. 다른 작품을 골라 주세요.",
  NOVEL_SOURCE_UPSTREAM_ERROR: "작품 목록 제공처(Project Gutenberg)가 오류로 답했습니다. 잠시 뒤 다시 검색해 주세요.",
  NOVEL_SOURCE_UPSTREAM_INVALID: "작품 목록 제공처의 응답을 읽을 수 없습니다. 잠시 뒤 다시 검색해 주세요.",
  NOVEL_SOURCE_UNAVAILABLE: "작품 제공처(Project Gutenberg)가 제때 답하지 않았거나 연결하지 못했습니다. 처음 찾는 검색어는 제공처가 답하는 데 오래 걸릴 수 있어, 잠시 뒤 같은 검색을 다시 누르면 대개 됩니다. 계속되면 인터넷 연결을 확인해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** 서버의 원문 대신 코드마다 정해 둔 문장만 보여 줍니다. */
export function toNovelSourceDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof NovelSourceApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) return { code: error.code, message: SAFE_ERRORS[error.code]! };
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function post<T>(url: string, body: unknown, guard: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new NovelSourceApiError(NETWORK.code, NETWORK.message);
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch { parsed = undefined; }
  if (!response.ok) {
    const code = isRecord(parsed) && typeof parsed.code === "string" && parsed.code.trim() ? parsed.code : MALFORMED.code;
    if (isServerUnavailable(response.status, code)) throw new NovelSourceApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    throw new NovelSourceApiError(code, "");
  }
  if (!guard(parsed)) throw new NovelSourceApiError(MALFORMED.code, MALFORMED.message);
  return parsed;
}

/** 목록만 — 본문은 받지 않습니다. 정확한 분량은 목록 단계에서 알 수 없습니다(제공처가 주지 않음). */
export function searchNovelSources(request: NovelSourceSearchRequest): Promise<NovelSourceSearchResponse> {
  return post(API_ROUTES.novelSourceSearch, request, isNovelSourceSearchResponse);
}

/**
 * 고른 한 편의 길이를 확인하고, 분석 한도 안이면 본문을 받습니다. 한도를 넘으면 장 목록만 오고(`needsChapterRange`),
 * 사람이 연속된 장 범위를 고른 뒤 다시 부르면 그 범위의 본문이 옵니다(그래도 길면 `selectionTooLong`).
 */
export function importNovelSource(request: NovelSourceImportRequest): Promise<NovelSourceImportResponse> {
  return post(API_ROUTES.novelSourceImport, request, isNovelSourceImportResponse);
}
