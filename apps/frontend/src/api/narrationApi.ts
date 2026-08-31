import {
  API_ROUTES,
  type GetNarrationReviewResponse,
  type NarrationReview,
  type Project,
  type RegenerateNarrationRequest,
  type RegenerateNarrationResponse,
  type SceneNumber,
  type StartNarrationGenerationRequest,
  type StartNarrationGenerationResponse,
} from "@ai-animation-studio/shared";
import { BUDGET_LEDGER_UNREADABLE, BUDGET_LEDGER_UNREADABLE_MESSAGE } from "./budgetLedgerError.js";

export class NarrationApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "NarrationApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  // Same sentence as longProjectsApi's entry, deliberately word for word: it is the same server code, and a
  // code that means one thing must not read differently depending on which screen surfaced it. It also names
  // no subject — this covers a project's own work and an Episode's, so a sentence that picked one would be
  // wrong for the other (that is exactly how the outline approval came to answer "이 에피소드를 처리하는 중").
  PROJECT_LOCKED: "이 프로젝트에서 다른 작업이 진행 중입니다. 다시 누르지 마세요 — 그 작업이 끝나면 자동으로 반영됩니다.",
  NARRATION_NOT_ENABLED: "프로젝트 설정에서 \"음성 넣기\"를 먼저 켜야 음성을 만들 수 있습니다.",
  NARRATION_MISSING_TEXT: "이 장면에는 읽어줄 문장이 없어 음성을 만들 수 없습니다. 대본을 다시 만들어 주세요.",
  NARRATION_GENERATION_FAILED: "음성 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
  NARRATION_STORAGE_ERROR: "음성 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  [BUDGET_LEDGER_UNREADABLE]: BUDGET_LEDGER_UNREADABLE_MESSAGE,
  NARRATION_BUDGET_EXCEEDED: "이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다.",
  NARRATION_CONTENT_UNAVAILABLE: "요청한 장면의 음성 파일을 찾을 수 없습니다.",
};

/**
 * Provider failures arrive as one code with a `details.category`, so the category — not the backend's own
 * message — decides what the user is told. Mirrors the image and video modules' category maps.
 */
const PROVIDER_ERROR_CATEGORY_MESSAGES: Record<string, string> = {
  authentication: "OpenAI 인증에 실패했습니다. API 설정에서 키를 다시 확인해 주세요.",
  rate_limit: "OpenAI 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.",
  context_length_exceeded: "내레이션 문장이 모델이 처리할 수 있는 길이를 초과했습니다. 문장을 줄여서 다시 시도해 주세요.",
  invalid_request: "OpenAI가 요청 형식을 지원하지 않습니다.",
  server_error: "OpenAI 서버 오류로 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  network: "OpenAI에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.",
};
const PROVIDER_ERROR_FALLBACK = "OpenAI 음성 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";

const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code/category. */
export function toNarrationDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof NarrationApiError)) return UNKNOWN;
  if (error.code === "NARRATION_PROVIDER_ERROR") {
    const category = typeof error.details?.category === "string" ? error.details.category : "";
    return {
      code: error.code,
      message: PROVIDER_ERROR_CATEGORY_MESSAGES[category] ?? PROVIDER_ERROR_FALLBACK,
    };
  }
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
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isSceneNumberList(value: unknown): value is SceneNumber[] {
  return Array.isArray(value) && value.every(isSceneNumber);
}

function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.workflowState === "string" &&
    Array.isArray(value.scenes) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.errors)
  );
}

function isNarrationReview(value: unknown): value is NarrationReview {
  return (
    isRecord(value) &&
    isSceneNumber(value.sceneNumber) &&
    typeof value.narration === "string" &&
    (value.audio === "none" || value.audio === "placeholder" || value.audio === "generated") &&
    // Optional, but never a non-number: the screen does arithmetic with it.
    (value.audioDurationSeconds === undefined || typeof value.audioDurationSeconds === "number")
  );
}

function isNarrationReviewList(value: unknown): value is NarrationReview[] {
  return Array.isArray(value) && value.every(isNarrationReview);
}

function isStartNarrationGenerationResponse(value: unknown): value is StartNarrationGenerationResponse {
  return (
    isRecord(value) &&
    isProject(value.project) &&
    isSceneNumberList(value.generatedSceneNumbers) &&
    isSceneNumberList(value.reusedSceneNumbers) &&
    isSceneNumberList(value.skippedSceneNumbers)
  );
}

function isGetNarrationReviewResponse(value: unknown): value is GetNarrationReviewResponse {
  return isRecord(value) && isProject(value.project) && isNarrationReviewList(value.narrations);
}

function isRegenerateNarrationResponse(value: unknown): value is RegenerateNarrationResponse {
  return (
    isRecord(value) &&
    isProject(value.project) &&
    isNarrationReviewList(value.narrations) &&
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
    throw new NarrationApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new NarrationApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!guard(body)) throw new NarrationApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

export function getNarrationReview(projectId: string): Promise<GetNarrationReviewResponse> {
  return request(API_ROUTES.narrationReview(projectId), undefined, isGetNarrationReviewResponse);
}

/** Synthesizes audio for every scene that has narration text. Must only be called after explicit confirmation. */
export function startNarrationGeneration(projectId: string): Promise<StartNarrationGenerationResponse> {
  const requestBody: StartNarrationGenerationRequest = { approved: true };
  return request(
    API_ROUTES.narrationGenerations(projectId),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isStartNarrationGenerationResponse,
  );
}

/** Replaces one scene's narration audio. Costs one more TTS call, so it needs its own confirmation. */
export function regenerateNarration(
  projectId: string,
  sceneNumber: SceneNumber,
  additionalInstruction?: string,
): Promise<RegenerateNarrationResponse> {
  const trimmed = additionalInstruction?.trim();
  const requestBody: RegenerateNarrationRequest = trimmed ? { approved: true, additionalInstruction: trimmed } : { approved: true };
  return request(
    API_ROUTES.narrationRegeneration(projectId, sceneNumber),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isRegenerateNarrationResponse,
  );
}

/** `cacheBuster` forces the browser to refetch after a scene's audio is regenerated. */
export function narrationContentUrl(projectId: string, sceneNumber: SceneNumber, cacheBuster: string): string {
  return `${API_ROUTES.narrationContent(projectId, sceneNumber)}?v=${encodeURIComponent(cacheBuster)}`;
}
