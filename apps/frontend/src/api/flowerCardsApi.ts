import { API_ROUTES, type CreateFlowerCardRequest, type CreateFlowerCardResponse } from "@ai-animation-studio/shared";
import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

/**
 * Creating one flower reel — a flower's meaning told over a seed being planted and opening into the bloom.
 *
 * Its own module rather than a function on projectsApi for the same reason the photo card has one: its
 * failures are its own. `FLOWER_CARD_STORAGE_ERROR` and `PROJECT_ALREADY_EXISTS` reach a person who has just
 * typed a name and several sentences, and the difference between "that name is taken" and "the disk refused"
 * decides whether they change one field or stop — a shared message cannot say either.
 *
 * 🔴 This request costs nothing. It writes a project and its scenes and calls no provider: the script is
 * written by hand precisely because a flower's origin is a fact, and a story model asked for a fact produces
 * something shaped like one. The first paid step is image generation, which has its own confirmation.
 */
export class FlowerCardsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "FlowerCardsApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요.",
  UNSAFE_PROJECT_ID: "이름은 문자, 숫자, '_', '-'만 사용할 수 있습니다.",
  PROJECT_ALREADY_EXISTS: "같은 이름이 이미 있습니다. 다른 이름을 써 주세요.",
  FLOWER_CARD_STORAGE_ERROR: "꽃말 릴스를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toFlowerCardDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof FlowerCardsApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  // Safe here, unlike on the paid screens: nothing was charged, so "다시 눌러도" cannot cost a second time.
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Both halves are checked, because the screen acts on both.
 *
 * 🔴 `review` is not decoration. Approving an Asset Mapping review compares the script fingerprint against a
 * baseline, and a project whose review was never opened reads back `""` — which comes out of approval as
 * `no_baseline`, the refusal 캡틴D hit and stopped at. Story generation opens that review as part of
 * finishing; this route has no story call and opens it here instead. A response that carried a project and no
 * review would send someone to a mapping screen they cannot leave, and the button would look like it worked.
 */
const isCreateFlowerCardResponse = (value: unknown): value is CreateFlowerCardResponse =>
  isRecord(value)
  && isRecord(value.project) && typeof value.project.id === "string" && value.project.id.length > 0
  && isRecord(value.review);

export async function createFlowerCard(request: CreateFlowerCardRequest): Promise<CreateFlowerCardResponse> {
  let response: Response;
  try {
    response = await fetch(API_ROUTES.flowerCards, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new FlowerCardsApiError(NETWORK.code, NETWORK.message);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const carriedCode = isRecord(body) && typeof body.code === "string" && body.code.trim() ? body.code : MALFORMED.code;
    // A 5xx that did not even carry the backend's own error shape means the backend never answered — it is
    // down, restarting, or something in front of it replied. Say that, instead of blaming the response body.
    if (isServerUnavailable(response.status, carriedCode)) {
      throw new FlowerCardsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    const details = isRecord(body) && isRecord(body.details) ? body.details : undefined;
    throw new FlowerCardsApiError(carriedCode, "", details);
  }
  if (!isCreateFlowerCardResponse(body)) throw new FlowerCardsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}
