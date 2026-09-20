import { API_ROUTES, type CreateNewsReelRequest, type CreateNewsReelResponse } from "@ai-animation-studio/shared";

import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

/**
 * Making one news reel: pictures already in the Library, one card burned over them.
 *
 * Its own module rather than a function on photoCardsApi, for the reason that module gives about itself — its
 * failures are its own. NEWS_REEL_INVALID_REQUEST in particular is the one refusal a person can act on
 * directly: the boxes on screen already count characters, so reaching this means something the screen let
 * through, and the sentence has to send them back to the boxes rather than suggest pressing again.
 *
 * Written by CLI alongside the route it calls (Round 1043). The button that calls it is Cowork's.
 */
export class NewsReelsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "NewsReelsApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요.",
  UNSAFE_PROJECT_ID: "이름은 문자, 숫자, '_', '-'만 사용할 수 있습니다.",
  PROJECT_ALREADY_EXISTS: "같은 이름이 이미 있습니다. 다른 이름을 써 주세요.",
  // Back to the boxes, not back to the button: the server measured the same limits the screen shows.
  NEWS_REEL_INVALID_REQUEST: "릴 문구를 확인해 주세요. 글자 수가 넘었거나 빈 칸이 있습니다.",
  // Not a retry — the same picture reads the same way next time. The answer is a different picture.
  NEWS_REEL_ASSET_UNUSABLE: "고른 그림을 읽지 못했습니다. 다시 눌러도 같은 결과이니 다른 그림을 골라 주세요.",
  NEWS_REEL_STORAGE_ERROR: "릴을 저장하지 못했습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message — only a fixed, safe sentence per code. */
export function toNewsReelDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof NewsReelsApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Checked down to the one field the caller acts on — the screen sends the person to this project's merge
 * screen, so a missing id would navigate nowhere and look like the button did nothing.
 */
function isCreateNewsReelResponse(value: unknown): value is CreateNewsReelResponse {
  if (!isRecord(value)) return false;
  const project = value.project;
  return isRecord(project) && typeof project.id === "string" && project.id.trim().length > 0;
}

export async function createNewsReel(request: CreateNewsReelRequest): Promise<CreateNewsReelResponse> {
  let response: Response;
  try {
    response = await fetch(API_ROUTES.newsReels, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new NewsReelsApiError(NETWORK.code, NETWORK.message);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const carriedCode = isRecord(body) && typeof body.code === "string" && body.code.trim() ? body.code : MALFORMED.code;
    // A 5xx carrying none of the backend's own error shape means the backend never answered. Say that, rather
    // than blaming the response body.
    if (isServerUnavailable(response.status, carriedCode)) {
      throw new NewsReelsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    const details = isRecord(body) && isRecord(body.details) ? body.details : undefined;
    throw new NewsReelsApiError(carriedCode, "", details);
  }
  if (!isCreateNewsReelResponse(body)) throw new NewsReelsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}
