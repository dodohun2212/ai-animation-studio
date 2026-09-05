import {
  BUDGET_LIMIT_ROUTE_HINT,
  API_ROUTES,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  type ApproveStoryPromptRequest,
  type ApproveStoryPromptResponse,
  type CreateStoryPromptDraftPreviewResponse,
  type CreateStoryPromptPreviewResponse,
  type Project,
  type RegenerateStoryPromptRequest,
  type RegenerateStoryPromptResponse,
  type ShortProjectSettingsInput,
  type StoryPromptPreview,
} from "@ai-animation-studio/shared";
import { isSha256Hex } from "@ai-animation-studio/shared";
import { BUDGET_LEDGER_UNREADABLE, BUDGET_LEDGER_UNREADABLE_MESSAGE } from "./budgetLedgerError.js";

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
  // Word for word with the six other tables that carry this code — the same server code must not read
  // differently depending on which button the person pressed. And the sentence is doing one specific job: the
  // generic fallback says "잠시 후 다시 시도해 주세요", and pressing a paid button again while its first press
  // still holds the lock is the double submission the lock exists to prevent.
  PROJECT_LOCKED: "이 프로젝트에서 다른 작업이 진행 중입니다. 다시 누르지 마세요 — 그 작업이 끝나면 자동으로 반영됩니다.",
  STORY_PROMPT_STALE: "Story 프롬프트가 그 사이에 변경되었습니다. 미리보기를 다시 불러와 주세요.",
  [BUDGET_LEDGER_UNREADABLE]: BUDGET_LEDGER_UNREADABLE_MESSAGE,
  STORY_BUDGET_EXCEEDED: `이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다. ${BUDGET_LIMIT_ROUTE_HINT}`,
  STORY_PROVIDER_ERROR: "OpenAI Story 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  // The server re-checks the same precondition the screen checks, and is the authority: the two can disagree
  // when another tab generated images in the meantime. Says what to do, not just what failed.
  STORY_REGENERATION_NOT_ALLOWED:
    "장면 이미지를 이미 만든 뒤에는 대본을 다시 만들 수 없습니다. 장면 편집에서 고치거나 새 프로젝트를 만들어 주세요.",
};
// The backend classifies every OpenAI provider failure into one of these closed categories (see
// openai-common.ts's OpenAiErrorCategory) and sends it back as details.category alongside
// STORY_PROVIDER_ERROR. Only "rate_limit"/"server"/"network" are actually worth retrying — showing the
// same generic "다시 시도해 주세요" for an auth/quota/policy failure is misleading (retrying never helps
// and, for a paid provider, just wastes the user's time wondering why nothing works).
const PROVIDER_ERROR_CATEGORY_MESSAGES: Record<string, string> = {
  authentication: "OpenAI API 키 인증에 실패했습니다. API 설정 화면에서 키가 올바른지 확인해 주세요.",
  quota_or_permission: "OpenAI 사용 한도 또는 프로젝트 권한 문제로 요청이 거부되었습니다. OpenAI 계정 상태를 확인해 주세요.",
  rate_limit: "OpenAI 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  server: "OpenAI 서버에 일시적인 오류가 있습니다. 잠시 후 다시 시도해 주세요.",
  network: "OpenAI 연결이 시간 초과되었거나 네트워크에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
  invalid_request: "요청 형식이 지원되지 않습니다. 문제가 계속되면 알려주세요.",
  safety_policy: "OpenAI 안전 정책에 따라 요청이 거부되었습니다. 내용을 수정한 뒤 다시 시도해 주세요 — 자동으로 재시도되지 않습니다.",
  // Retrying unchanged always fails, so the message names the specific fields to shorten instead.
  context_length_exceeded: "설정 내용이 모델이 처리할 수 있는 길이를 초과했습니다. 세계관·전체 줄거리·캐릭터 설명 등을 줄여서 다시 시도해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message text — only a fixed, safe message per code (or per known category). */
export function toStoryDisplayError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (!(error instanceof StoryPromptApiError)) return UNKNOWN;
  if (error.code === "STORY_PROVIDER_ERROR") {
    const category = error.details && typeof error.details.category === "string" ? error.details.category : undefined;
    const message = (category && PROVIDER_ERROR_CATEGORY_MESSAGES[category]) ?? SAFE_ERRORS.STORY_PROVIDER_ERROR!;
    return error.details ? { code: error.code, message, details: error.details } : { code: error.code, message };
  }
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

const isDigest = isSha256Hex;

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
    typeof value.sceneCount === "number" &&
    Number.isInteger(value.sceneCount) &&
    value.sceneCount >= MIN_SCENE_COUNT &&
    value.sceneCount <= MAX_SCENE_COUNT
  );
}

function isPreviewResponse(value: unknown): value is CreateStoryPromptPreviewResponse {
  return isRecord(value) && isPreview(value.preview);
}

function isDraftPreviewResponse(value: unknown): value is CreateStoryPromptDraftPreviewResponse {
  return isRecord(value) && typeof value.prompt === "string";
}

function isRegenerationResponse(value: unknown): value is RegenerateStoryPromptResponse {
  return isRecord(value) && isProject(value.project);
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
  settings: ShortProjectSettingsInput,
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

/**
 * Clears this project's Story so it can be written again, and does nothing else — no provider is called and
 * nothing is charged here. The new Story costs money only when the prompt is approved afterwards, exactly
 * like the first time. The server re-checks the precondition (a Story exists, no scene images yet) and is
 * the authority on it; `approved: true` is the same explicit opt-in the approval endpoint requires, so a
 * destructive call can never be a stray request.
 */
export function regenerateStoryPrompt(projectId: string): Promise<RegenerateStoryPromptResponse> {
  const requestBody: RegenerateStoryPromptRequest = { approved: true };
  return request(
    API_ROUTES.storyRegeneration(projectId),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isRegenerationResponse,
  );
}
