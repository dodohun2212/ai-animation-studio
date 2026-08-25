import {
  API_ROUTES,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  type BudgetPreview,
  type GetVideoPromptPreviewResponse,
  type SceneNumber,
  type VideoPromptPreview,
} from "@ai-animation-studio/shared";

export class VideoPreviewApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "VideoPreviewApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  VIDEO_PREVIEW_NOT_ALLOWED: "영상 미리보기는 모든 장면 이미지가 승인된 프로젝트에서만 가능합니다.",
  VIDEO_PREVIEW_IMAGES_INVALID: "승인된 장면 이미지가 유효하지 않습니다. 이미지를 다시 확인해 주세요.",
  VIDEO_PREVIEW_DATA_INVALID: "영상 프롬프트 데이터를 확인할 수 없습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toVideoPreviewDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof VideoPreviewApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  return UNKNOWN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSceneNumber(value: unknown): value is SceneNumber {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SCENE_COUNT;
}

function isVideoPromptPreview(value: unknown): value is VideoPromptPreview {
  return (
    isRecord(value) &&
    isSceneNumber(value.sceneNumber) &&
    isNonEmptyString(value.prompt) &&
    value.model === "gen4_turbo" &&
    (value.ratio === "720:1280" || value.ratio === "1280:720") &&
    value.durationSeconds === 5 &&
    typeof value.estimatedCostUsd === "number" &&
    value.estimatedCostUsd >= 0
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * The spend guard shown before a paid submission. Optional on the contract, so an older/partial response
 * is tolerated — but a malformed one is rejected outright rather than displayed, because a wrong budget
 * number is worse than none at all.
 */
function isBudgetPreview(value: unknown): value is BudgetPreview {
  if (value === undefined) return true;
  return (
    isRecord(value) &&
    isFiniteNonNegative(value.monthlyLimitUsd) &&
    isFiniteNonNegative(value.spentUsd) &&
    isFiniteNonNegative(value.remainingUsd) &&
    isFiniteNonNegative(value.estimatedRequestCostUsd) &&
    typeof value.canSpend === "boolean"
  );
}

/** Every preview response must carry every scene belonging to the project (2-12), 1..N in order — never fewer, never out of order. */
function isGetVideoPromptPreviewResponse(value: unknown): value is GetVideoPromptPreviewResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.previews) &&
    value.previews.length >= MIN_SCENE_COUNT &&
    value.previews.length <= MAX_SCENE_COUNT &&
    value.previews.every((item, index) => isVideoPromptPreview(item) && item.sceneNumber === index + 1) &&
    (value.maximumProviderCalls === undefined || isFiniteNonNegative(value.maximumProviderCalls)) &&
    isBudgetPreview(value.budget)
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

async function request<T>(url: string, init: RequestInit | undefined, guard: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try {
    response = init ? await fetch(url, init) : await fetch(url);
  } catch {
    throw new VideoPreviewApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new VideoPreviewApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!guard(body)) throw new VideoPreviewApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

/**
 * Local-only preview of the six Runway prompts and their estimated cost — never calls a paid
 * provider and never persists edits. Only sent when explicitly invoked by the caller.
 */
export function getVideoPromptPreview(projectId: string): Promise<GetVideoPromptPreviewResponse> {
  return request(API_ROUTES.videoPreview(projectId), { method: "POST" }, isGetVideoPromptPreviewResponse);
}
