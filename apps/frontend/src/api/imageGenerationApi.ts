import {
  API_ROUTES,
  type Project,
  type SceneNumber,
  type StartImageGenerationRequest,
  type StartImageGenerationResponse,
} from "@ai-animation-studio/shared";

export class ImageGenerationApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ImageGenerationApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  IMAGE_GENERATION_NOT_ALLOWED: "Asset Mapping이 승인된 프로젝트에서만 이미지를 생성할 수 있습니다.",
  ASSET_MAPPING_REVIEW_REQUIRED: "먼저 Asset Mapping 검토를 승인해야 합니다.",
  IMAGE_GENERATION_FAILED: "이미지 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  IMAGE_STORAGE_ERROR: "이미지 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  IMAGE_BUDGET_EXCEEDED: "이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다.",
  IMAGE_PROVIDER_ERROR: "OpenAI 이미지 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  IMAGE_CONTENT_UNAVAILABLE: "이미지를 불러올 수 없습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toImageGenerationDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof ImageGenerationApiError)) return UNKNOWN;
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

function isSceneNumberArray(value: unknown): value is SceneNumber[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && item >= 1 && item <= 6);
}

function isStartImageGenerationResponse(value: unknown): value is StartImageGenerationResponse {
  return (
    isRecord(value) &&
    isProject(value.project) &&
    isSceneNumberArray(value.generatedSceneNumbers) &&
    isSceneNumberArray(value.reusedSceneNumbers)
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

/** Sends the explicit `{ approved: true }` request only when called — never on render or preview. */
export async function startImageGeneration(projectId: string): Promise<StartImageGenerationResponse> {
  const requestBody: StartImageGenerationRequest = { approved: true };
  let response: Response;
  try {
    response = await fetch(API_ROUTES.imageGeneration(projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch {
    throw new ImageGenerationApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new ImageGenerationApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!isStartImageGenerationResponse(body)) throw new ImageGenerationApiError(MALFORMED.code, MALFORMED.message);
  return body;
}
