import {
  BUDGET_LIMIT_ROUTE_HINT,
  API_ROUTES,
  NARRATION_AUDIO_STATES,
  type GetNarrationReviewResponse,
  type NarrationReview,
  type Project,
  type RegenerateNarrationRequest,
  type RegenerateNarrationResponse,
  type SceneNumber,
  type OpenAiErrorCategory,
  type StartNarrationGenerationRequest,
  type StartNarrationGenerationResponse,
} from "@ai-animation-studio/shared";
import { BUDGET_LEDGER_UNREADABLE, BUDGET_LEDGER_UNREADABLE_MESSAGE } from "./budgetLedgerError.js";
import { narrationFailureMessage } from "../utils/sceneFailureAdvice.js";
import { isBudgetPreview, isSceneStaleness } from "./contractGuards.js";
import { SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

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
  NARRATION_BUDGET_EXCEEDED: `이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다. ${BUDGET_LIMIT_ROUTE_HINT}`,
  NARRATION_CONTENT_UNAVAILABLE: "요청한 장면의 음성 파일을 찾을 수 없습니다.",
};

/**
 * Provider failures arrive as one code with a `details.category`, so the category — not the backend's own
 * message — decides what the user is told. Mirrors the image and video modules' category maps.
 *
 * 키는 지어내는 것이 아니라 **백엔드가 실제로 보내는 닫힌 목록**입니다: `classifyOpenAiHttpError`가 돌려주는
 * `OpenAiErrorCategory` 그대로 `narrationProviderError(error.category, …)` 를 거쳐 `details.category` 에 담깁니다
 * (`narration-review.service.ts:151` · `local-narration-generation.service.ts:139`). 이 표에는 그 목록에 없는
 * 키가 있었고 — `server_error` — 백엔드가 보내는 이름은 `server` 입니다. 한 번도 맞은 적이 없는
 * 키였고, 그래서 OpenAI 5xx 는 전부 아래 fallback 으로 떨어졌습니다. `Record<string, string>` 이라
 * 컴파일이 아무 말도 안 하고, 짝도 `rate_limit` 하나만 박아둔터라 보지 못했습니다.
 *
 * 또 `quota_or_permission` · `safety_policy` 두 개가 빠져 있었고, 둘 다 **다시 눌러도 같은 결과**인데
 * fallback 은 「잠시 후 다시 시도」를 권합니다 — 음성은 호출마다 돈이 나가므로 그 권유는 틀린 방향입니다.
 * `unknown` · `empty_response` · `invalid_response` 는 일부러 fallback 에 남깁니다(그 세 개는 「잠시 후
 * 다시」가 실제로 맞는 유일한 조언입니다).
 *
 * 🔴 `Partial<Record<OpenAiErrorCategory, string>>`, not `Record<string, string>`. That is what makes
 * `server_error` — the key that sat here never matching anything — a compile error rather than a silent miss.
 * `Partial` because `unknown` · `empty_response` · `invalid_response` are deliberately left to the fallback,
 * which is the only honest advice for them; a full `Record` would demand a sentence this module cannot write.
 */
const PROVIDER_ERROR_CATEGORY_MESSAGES: Partial<Record<OpenAiErrorCategory, string>> = {
  authentication: "OpenAI 인증에 실패했습니다. API 설정에서 키를 다시 확인해 주세요.",
  quota_or_permission:
    "OpenAI 사용 한도 또는 프로젝트 권한 문제로 요청이 거부되었습니다. OpenAI 계정 상태를 확인해 주세요 — 계정을 고치기 전에는 다시 눌러도 같은 결과입니다.",
  rate_limit: "OpenAI 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.",
  context_length_exceeded: "내레이션 문장이 모델이 처리할 수 있는 길이를 초과했습니다. 문장을 줄여서 다시 시도해 주세요.",
  invalid_request: "OpenAI가 요청 형식을 지원하지 않습니다.",
  safety_policy:
    "OpenAI 안전 정책에 따라 이 문장이 거부되었습니다. 내레이션 문장을 고친 뒤에 다시 시도해 주세요 — 자동으로 재시도되지 않습니다.",
  server: "OpenAI 서버 오류로 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
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
    const categoryMessage = PROVIDER_ERROR_CATEGORY_MESSAGES[category as OpenAiErrorCategory] ?? PROVIDER_ERROR_FALLBACK;
    /* The category names what OpenAI said; the details name where the run stopped, what already exists, and what
       pressing the button again would do. Composed by the same function the image screens use, so the two
       pipelines cannot drift into saying it differently (docs/00_NOW.md ②-3). */
    return { code: error.code, message: narrationFailureMessage(categoryMessage, error.details) };
  }
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
    /* The contract already publishes this list; a guard that retypes it is a second copy that nothing
       keeps in step. Add a value to the contract and this guard silently REJECTS it — the response
       parses as malformed and the screen shows nothing, with no compile error anywhere. Same defect
       family as the outlineStatus label table (00_NOW.md ④), and the same fix: read the list. */
    (NARRATION_AUDIO_STATES as readonly string[]).includes(value.audio as string) &&
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
  return isRecord(value) && isProject(value.project) && isNarrationReviewList(value.narrations)
    && isBudgetPreview(value.budget) && isSceneStaleness(value.staleness);
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
    // A 5xx that did not even carry the backend's own error shape means the backend never answered — it is
    // down, restarting, or something in front of it replied. Say that, instead of blaming the response body.
    if (isServerUnavailable(response.status, apiError.code)) {
      throw new NarrationApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
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
