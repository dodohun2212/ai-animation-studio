import { API_ROUTES, type CreatePhotoCardRequest, type CreatePhotoCardResponse } from "@ai-animation-studio/shared";

/**
 * Creating one photo card — a single picture, a line of text burned under it, and a few seconds of slow zoom.
 *
 * It is its own module rather than a function on projectsApi because its failures are its own. In particular
 * PHOTO_CARD_ASSET_UNUSABLE is not a retry: the picture the person chose cannot be read, and pressing the same
 * button with the same picture chosen reads the same unreadable file. The answer is a different picture, and
 * the message has to say that instead of the generic "잠시 후 다시 시도해 주세요".
 */
export class PhotoCardsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PhotoCardsApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요.",
  UNSAFE_PROJECT_ID: "이름은 문자, 숫자, '_', '-'만 사용할 수 있습니다.",
  PROJECT_ALREADY_EXISTS: "같은 이름이 이미 있습니다. 다른 이름을 써 주세요.",
  // Not a retry — see this module's doc comment. The sentence names the action that actually resolves it.
  PHOTO_CARD_ASSET_UNUSABLE: "고른 그림을 읽지 못했습니다. 다시 눌러도 같은 결과이니 다른 그림을 골라 주세요.",
  PHOTO_CARD_STORAGE_ERROR: "사진 카드를 저장하지 못했습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toPhotoCardDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof PhotoCardsApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  return UNKNOWN;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Checked down to the one field the caller acts on. The screen sends the person straight to the merge screen
 * for this project, so an id that is not a string would navigate nowhere and look like the button did nothing.
 */
const isCreatePhotoCardResponse = (value: unknown): value is CreatePhotoCardResponse =>
  isRecord(value) && isRecord(value.project) && typeof value.project.id === "string" && value.project.id.length > 0;

export async function createPhotoCard(request: CreatePhotoCardRequest): Promise<CreatePhotoCardResponse> {
  let response: Response;
  try {
    response = await fetch(API_ROUTES.photoCards, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new PhotoCardsApiError(NETWORK.code, NETWORK.message);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const code = isRecord(body) && typeof body.code === "string" ? body.code : UNKNOWN.code;
    const details = isRecord(body) && isRecord(body.details) ? body.details : undefined;
    throw new PhotoCardsApiError(code, "", details);
  }
  if (!isCreatePhotoCardResponse(body)) throw new PhotoCardsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}
