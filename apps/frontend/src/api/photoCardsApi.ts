import {
  API_ROUTES,
  type CreatePhotoCardRequest,
  type CreatePhotoCardResponse,
  type GetPhotoCardSubtitleColorsResponse,
  type PhotoCardSubtitleColors,
} from "@ai-animation-studio/shared";
import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

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
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Checked down to the one field the caller acts on. The screen sends the person straight to the merge screen
 * for this project, so an id that is not a string would navigate nowhere and look like the button did nothing.
 */
const isCreatePhotoCardResponse = (value: unknown): value is CreatePhotoCardResponse =>
  isRecord(value) && isRecord(value.project) && typeof value.project.id === "string" && value.project.id.length > 0;

/**
 * `#RRGGBB`, and nothing else.
 *
 * 🔴 These three strings are put straight into `color` and `text-shadow`. Anything that is not exactly six hex
 * digits behind a `#` is refused here rather than handed to CSS — a preview is not a place to find out what a
 * browser does with an arbitrary string, and a colour that silently fails to apply would leave white text
 * claiming to be the merge's answer.
 */
const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

const isSubtitleColors = (value: unknown): value is PhotoCardSubtitleColors =>
  isRecord(value) && isHexColor(value.body) && isHexColor(value.heading) && isHexColor(value.outline);

/**
 * Checked as a three-way answer, not two.
 *
 * `colors: null` is a real answer — the picture could not be read, and the merge will then burn plain white on
 * a black outline, which the preview draws. A response with no `colors` key at all is a different thing (a
 * malformed answer) and must not collapse into the same `null`, or a broken lookup would quietly look like a
 * picture the server had read and given up on.
 */
const isSubtitleColorsResponse = (value: unknown): value is GetPhotoCardSubtitleColorsResponse =>
  isRecord(value) && "colors" in value && (value.colors === null || isSubtitleColors(value.colors));

/**
 * The colours the merge would burn for this card's text, with the band centred at `center`.
 *
 * The preview asked to match the video (CLI Round 888) and this is the only way it can: the server samples the
 * picture with the same function the merge runs, so the two cannot drift. Local and free — no paid provider is
 * involved — but each call is one pass over the picture, so the caller asks once after the slider settles
 * rather than on every step of a drag.
 *
 * `center` omitted means the card's own stored layout.
 */
export async function getPhotoCardSubtitleColors(projectId: string, center?: number): Promise<GetPhotoCardSubtitleColorsResponse> {
  let response: Response;
  try {
    response = await fetch(API_ROUTES.photoCardSubtitleColors(projectId, center));
  } catch {
    throw new PhotoCardsApiError(NETWORK.code, NETWORK.message);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const carriedCode = isRecord(body) && typeof body.code === "string" && body.code.trim() ? body.code : MALFORMED.code;
    if (isServerUnavailable(response.status, carriedCode)) {
      throw new PhotoCardsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    throw new PhotoCardsApiError(carriedCode, "", isRecord(body) && isRecord(body.details) ? body.details : undefined);
  }
  if (!isSubtitleColorsResponse(body)) throw new PhotoCardsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

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
    const carriedCode = isRecord(body) && typeof body.code === "string" && body.code.trim() ? body.code : MALFORMED.code;
    // A 5xx that did not even carry the backend's own error shape means the backend never answered — it is
    // down, restarting, or something in front of it replied. Say that, instead of blaming the response body.
    if (isServerUnavailable(response.status, carriedCode)) {
      throw new PhotoCardsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    const code = isRecord(body) && typeof body.code === "string" ? body.code : UNKNOWN.code;
    const details = isRecord(body) && isRecord(body.details) ? body.details : undefined;
    throw new PhotoCardsApiError(code, "", details);
  }
  if (!isCreatePhotoCardResponse(body)) throw new PhotoCardsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}
