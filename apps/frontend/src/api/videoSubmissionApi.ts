import {
  BUDGET_LIMIT_ROUTE_HINT,
  API_ROUTES,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  type StartVideoGenerationRequest,
  type StartVideoGenerationResponse,
} from "@ai-animation-studio/shared";
import { BUDGET_LEDGER_UNREADABLE, BUDGET_LEDGER_UNREADABLE_MESSAGE } from "./budgetLedgerError.js";
import { SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

export class VideoSubmissionApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "VideoSubmissionApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  VIDEO_SUBMISSION_NOT_ALLOWED: "영상 생성 요청은 모든 장면 이미지 승인과 영상 확인 대기 상태에서만 보낼 수 있습니다.",
  VIDEO_CONFIRMATION_STALE: "미리보기 내용이 그 사이에 변경되었습니다. 새로고침 후 다시 확인해 주세요.",
  VIDEO_REQUEST_ID_CONFLICT: "이전 요청과 내용이 달라 처리할 수 없습니다. 새로고침 후 다시 시도해 주세요.",
  [BUDGET_LEDGER_UNREADABLE]: BUDGET_LEDGER_UNREADABLE_MESSAGE,
  VIDEO_BUDGET_EXCEEDED: `설정된 예산을 초과하여 전송할 수 없습니다. ${BUDGET_LIMIT_ROUTE_HINT}`,
  VIDEO_CALL_LIMIT_EXCEEDED: "허용된 Provider 호출 횟수를 초과했습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toVideoSubmissionDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof VideoSubmissionApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  return UNKNOWN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Every acceptance response must cover every scene belonging to the project (2-12), 1..N in order — never fewer, never out of order. */
function isStartVideoGenerationResponse(value: unknown): value is StartVideoGenerationResponse {
  return (
    isRecord(value) &&
    isNonEmptyString(value.jobId) &&
    Array.isArray(value.acceptedSceneNumbers) &&
    value.acceptedSceneNumbers.length >= MIN_SCENE_COUNT &&
    value.acceptedSceneNumbers.length <= MAX_SCENE_COUNT &&
    value.acceptedSceneNumbers.every((sceneNumber, index) => sceneNumber === index + 1)
  );
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toApiErrorShape(body: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)) {
    const details = isRecord(body.details) ? body.details : undefined;
    return details ? { code: body.code, message: body.message, details } : { code: body.code, message: body.message };
  }
  return MALFORMED;
}

/**
 * Sends the single, explicit, already-confirmed local acceptance gate request. This never
 * contacts Runway or any paid provider — it only records a local fake job that a later
 * Runway adapter may act on. Only call this from the final step of an explicit two-step
 * user confirmation, never automatically.
 */
export async function startVideoSubmission(
  projectId: string,
  requestBody: StartVideoGenerationRequest,
): Promise<StartVideoGenerationResponse> {
  let response: Response;
  try {
    response = await fetch(API_ROUTES.videoGeneration(projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch {
    throw new VideoSubmissionApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    // A 5xx that did not even carry the backend's own error shape means the backend never answered — it is
    // down, restarting, or something in front of it replied. Say that, instead of blaming the response body.
    if (isServerUnavailable(response.status, apiError.code)) {
      throw new VideoSubmissionApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    throw new VideoSubmissionApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!isStartVideoGenerationResponse(body)) throw new VideoSubmissionApiError(MALFORMED.code, MALFORMED.message);
  return body;
}
