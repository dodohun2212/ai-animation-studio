import {
  API_ROUTES,
  type ApproveImageReviewRequest,
  type ApproveImageReviewResponse,
  type GetImageReviewResponse,
  type ImageReview,
  type Project,
  type RegenerateImageReviewRequest,
  type RegenerateImageReviewResponse,
  type SceneNumber,
} from "@ai-animation-studio/shared";

export class ImageReviewApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ImageReviewApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  IMAGE_REVIEW_NOT_ALLOWED: "이미지 검토는 이미지 생성이 완료된 프로젝트에서만 가능합니다.",
  IMAGE_REVIEW_IMAGE_INVALID: "생성된 이미지가 유효하지 않습니다. 이미지를 다시 생성해 주세요.",
  IMAGE_REVIEW_DATA_INVALID: "이미지 검토 데이터가 올바르지 않습니다.",
  IMAGE_REVIEW_STORAGE_ERROR: "이미지 검토 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  IMAGE_REVIEW_BUDGET_EXCEEDED: "이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다.",
  IMAGE_REVIEW_PROVIDER_ERROR: "OpenAI 이미지 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toImageReviewDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof ImageReviewApiError)) return UNKNOWN;
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
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.topic === "string" &&
    isNonEmptyString(value.projectType) &&
    isNonEmptyString(value.workflowState) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    Array.isArray(value.scenes) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.errors)
  );
}

function isImageReview(value: unknown): value is ImageReview {
  return (
    isRecord(value) &&
    isSceneNumber(value.sceneNumber) &&
    (value.status === "pending" || value.status === "approved") &&
    isNonEmptyString(value.updatedAt)
  );
}

function isImageReviewList(value: unknown): value is ImageReview[] {
  return Array.isArray(value) && value.every(isImageReview);
}

function isGetImageReviewResponse(value: unknown): value is GetImageReviewResponse {
  return isRecord(value) && isProject(value.project) && isImageReviewList(value.reviews);
}

function isApproveImageReviewResponse(value: unknown): value is ApproveImageReviewResponse {
  return isRecord(value) && isProject(value.project) && isImageReviewList(value.reviews);
}

function isRegenerateImageReviewResponse(value: unknown): value is RegenerateImageReviewResponse {
  return (
    isRecord(value) &&
    isProject(value.project) &&
    isImageReviewList(value.reviews) &&
    isSceneNumber(value.sceneNumber)
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
    throw new ImageReviewApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new ImageReviewApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!guard(body)) throw new ImageReviewApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

export function getImageReview(projectId: string): Promise<GetImageReviewResponse> {
  return request(API_ROUTES.imageReview(projectId), undefined, isGetImageReviewResponse);
}

/** A review action is deliberately explicit and cannot be inferred from navigation. */
export function approveImageReview(projectId: string, sceneNumber: SceneNumber): Promise<ApproveImageReviewResponse> {
  const requestBody: ApproveImageReviewRequest = { approved: true };
  return request(
    API_ROUTES.imageReviewApproval(projectId, sceneNumber),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isApproveImageReviewResponse,
  );
}

/**
 * Replaces one scene's generated image via the local fake adapter only. Never sends a paid
 * provider request. Must only be called after an explicit second user confirmation.
 */
export function regenerateImageReview(projectId: string, sceneNumber: SceneNumber): Promise<RegenerateImageReviewResponse> {
  const requestBody: RegenerateImageReviewRequest = { approved: true };
  return request(
    API_ROUTES.imageReviewRegeneration(projectId, sceneNumber),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isRegenerateImageReviewResponse,
  );
}
