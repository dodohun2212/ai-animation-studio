import {
  API_ROUTES,
  type ApproveStoryPromptRequest,
  type ApproveStoryPromptResponse,
  type CreateStoryPromptDraftPreviewResponse,
  type CreateStoryPromptPreviewResponse,
  type Project,
  type ShortProjectSettings,
  type StoryPromptPreview,
} from "@ai-animation-studio/shared";

export class StoryPromptApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "StoryPromptApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  STORY_PROMPT_STALE: "Story 프롬프트가 그 사이에 변경되었습니다. 미리보기를 다시 불러와 주세요.",
  STORY_BUDGET_EXCEEDED: "이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다.",
  STORY_PROVIDER_ERROR: "OpenAI Story 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toStoryDisplayError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (!(error instanceof StoryPromptApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    const details = error.details;
    return details ? { code: error.code, message: SAFE_ERRORS[error.code]!, details } : { code: error.code, message: SAFE_ERRORS[error.code]! };
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

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const isDigest = (value: unknown): value is string => typeof value === "string" && DIGEST_PATTERN.test(value);

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

function isPreview(value: unknown): value is StoryPromptPreview {
  return (
    isRecord(value) &&
    isNonEmptyString(value.projectId) &&
    typeof value.originalPrompt === "string" &&
    isDigest(value.originalPromptSha256) &&
    typeof value.characterCount === "number" &&
    value.characterCount >= 0 &&
    value.sceneCount === 6
  );
}

function isPreviewResponse(value: unknown): value is CreateStoryPromptPreviewResponse {
  return isRecord(value) && isPreview(value.preview);
}

function isDraftPreviewResponse(value: unknown): value is CreateStoryPromptDraftPreviewResponse {
  return isRecord(value) && typeof value.prompt === "string";
}

function isApprovalResponse(value: unknown): value is ApproveStoryPromptResponse {
  return (
    isRecord(value) &&
    isProject(value.project) &&
    typeof value.originalPrompt === "string" &&
    typeof value.prompt === "string" &&
    isDigest(value.promptSha256) &&
    typeof value.modified === "boolean" &&
    isNonEmptyString(value.approvedAt)
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
    throw new StoryPromptApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new StoryPromptApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!guard(body)) throw new StoryPromptApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

/** Local-only preview of the exact Story request text — never calls a paid provider. */
export function createStoryPromptPreview(projectId: string): Promise<CreateStoryPromptPreviewResponse> {
  return request(API_ROUTES.storyPromptPreview(projectId), { method: "POST" }, isPreviewResponse);
}

/** Live, not-yet-saved preview of the exact Story prompt for the given draft settings — never persists, never calls a paid provider. */
export function createStoryPromptDraftPreview(
  projectId: string,
  settings: ShortProjectSettings,
): Promise<CreateStoryPromptDraftPreviewResponse> {
  return request(
    API_ROUTES.storyPromptDraftPreview(projectId),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) },
    isDraftPreviewResponse,
  );
}

export function approveStoryPrompt(
  projectId: string,
  requestBody: ApproveStoryPromptRequest,
): Promise<ApproveStoryPromptResponse> {
  return request(
    API_ROUTES.storyPromptApproval(projectId),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isApprovalResponse,
  );
}
