import { VIDEO_JOB_STATUSES,
  providerTaskFailure,
  BUDGET_LIMIT_ROUTE_HINT,
  API_ROUTES,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  type ApproveVideoReviewResponse,
  type GenerationProgressResponse,
  type GetVideoReviewResponse,
  type RecoverVideosResponse,
  type RegenerateVideoRequest,
  type RegenerateVideoResponse,
  type SceneNumber,
  type VideoReview,
} from "@ai-animation-studio/shared";
import { BUDGET_LEDGER_UNREADABLE_MESSAGE } from "./budgetLedgerError.js";
import { isBudgetPreview, isSceneFailureMap, isSceneStaleness } from "./contractGuards.js";
import { SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

export class VideoWorkflowApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "VideoWorkflowApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  VIDEO_JOB_NOT_FOUND: "요청한 로컬 영상 생성 작업을 찾을 수 없습니다.",
  VIDEO_WORKFLOW_NOT_ALLOWED: "현재 프로젝트 상태에서는 이 작업을 수행할 수 없습니다.",
  VIDEO_REVIEW_DATA_INVALID: "영상 검토 데이터를 확인할 수 없습니다.",
  VIDEO_STORAGE_ERROR: "영상 작업 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  VIDEO_CONTENT_UNAVAILABLE: "영상을 불러올 수 없습니다.",
  // Two windows on the same project, both advancing video generation. Wording matters more here than in any
  // other message on this screen: the generic fallback ("잠시 후 다시 시도해 주세요") tells the reader to press
  // the button again, and pressing it again is exactly the double submission this lock exists to prevent — the
  // one that actually charged $3.00 twice (docs/06_DECISIONS.md D-010). So it says the opposite, plainly,
  // and says the wait resolves itself.
  PROJECT_LOCKED: "다른 창에서 이 프로젝트를 처리하는 중입니다. 다시 누르지 마세요 — 그쪽 작업이 끝나면 자동으로 반영됩니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

// GenerationProgressResponse.sceneErrors carries a short failure code per failed scene — either a
// RunwayErrorCategory (submit/poll failure), one of our own synthesized codes, or (when Runway itself
// explicitly reports FAILED/CANCELLED) Runway's own raw free-text failure reason. Only the closed set of
// known codes below gets an actionable Korean message; anything else — including that raw Runway text —
// is treated as opaque and shown with a generic fallback rather than surfaced verbatim.
const SCENE_ERROR_CATEGORY_MESSAGES: Record<string, string> = {
  authentication: "Runway API 키 인증에 실패했습니다. API 설정 화면에서 키가 올바른지 확인해 주세요.",
  permission: "Runway 사용 권한 문제로 요청이 거부되었습니다. Runway 계정 상태를 확인해 주세요.",
  // Runway answers "not enough credits" with a 400, which used to land in `invalid_request` — so a person
  // whose account simply needed topping up was told the request format was unsupported and to report a bug.
  // The backend now re-reads the response body it already had and splits this out (Round 145).
  quota_or_permission: "Runway 크레딧이 부족합니다. Runway 계정에서 크레딧을 충전한 뒤 다시 시도해 주세요.",
  rate_limit: "Runway 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  invalid_request: "요청 형식이 지원되지 않습니다. 문제가 계속되면 알려주세요.",
  server: "Runway 서버에 일시적인 오류가 있습니다. 잠시 후 다시 시도해 주세요.",
  network: "Runway 연결이 시간 초과되었거나 네트워크에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
  timeout: "영상 생성이 제한 시간 안에 끝나지 않았습니다. 다시 시도해 주세요.",
  no_output: "Runway가 영상 결과물을 반환하지 않았습니다. 다시 시도해 주세요.",
  invalid_state: "영상 작업 상태가 예상과 달라 처리하지 못했습니다. 다시 시도해 주세요.",
  budget_exceeded: `이번 달 Runway 예산을 초과하여 요청을 보내지 않았습니다. ${BUDGET_LIMIT_ROUTE_HINT}`,
  // Not budget_exceeded. Reusing that reason would be a lie about money — nothing was overspent; the ledger
  // itself could not be read, so the amount spent is unknown and the request was never sent. Same sentence as
  // the HTTP-code label because it is the same cause, and one cause reading two ways is how a person ends up
  // fixing the wrong thing.
  budget_ledger_unreadable: BUDGET_LEDGER_UNREADABLE_MESSAGE,
  // The request went out but its outcome was never confirmed (the server stopped in between). Retrying on the
  // user's behalf could create a second billed task for one scene, so the backend deliberately stops here and
  // leaves the decision to the person paying — this message has to say that plainly, not read as a transient
  // glitch, or they will assume nothing happened and press again.
  submit_interrupted: "요청을 보낸 뒤 서버가 중단되어 결과를 확인하지 못했습니다. 요청이 이미 접수되었을 수 있어 자동으로 다시 보내지 않았습니다. Runway 계정에서 해당 작업이 생성되었는지 확인한 뒤 다시 시도해 주세요.",
};
const SCENE_ERROR_FALLBACK = "영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * The sentence for one failed scene — the provider's code first, this app's categories after.
 *
 * 🔴 A Runway task failure's `category` is the provider's own English sentence
 * ("An unexpected error occurred. (Runway code: INTERNAL.BAD_OUTPUT.CODE01)"), so it missed the table below
 * every time and fell through to "영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." That is the sentence
 * that was followed twice and charged twice on 2026-09-05 — and since the remedy advice shipped, it has been
 * sitting directly above it saying the opposite. One failure, two sentences, and no way to tell which is right.
 *
 * The codes and their causes live in the contract's `PROVIDER_TASK_FAILURES`, not here: the adapter already
 * decides `remedy` from those same strings, and a second list keyed on them in this file is the copy this
 * repository keeps finding — one that would drift in the worst direction.
 *
 * Cause only. Whether the attempt was charged is `billedOnFailure`'s sentence to make, one screen away, and
 * two sentences about one person's money is how the two end up disagreeing.
 */
export function sceneErrorMessage(code: string | undefined, providerCode?: string): string {
  const known = providerTaskFailure(providerCode);
  if (known) return known.message;
  if (!code) return SCENE_ERROR_FALLBACK;
  return SCENE_ERROR_CATEGORY_MESSAGES[code] ?? SCENE_ERROR_FALLBACK;
}

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toVideoWorkflowDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof VideoWorkflowApiError)) return UNKNOWN;
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
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SCENE_COUNT;
}

function isSceneNumberArray(value: unknown): value is SceneNumber[] {
  return Array.isArray(value) && value.every(isSceneNumber);
}

/** A job's full scene list must be non-empty, within the supported range, and strictly 1..N in order. */
function isJobSceneNumbers(value: unknown): value is SceneNumber[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_SCENE_COUNT &&
    value.length <= MAX_SCENE_COUNT &&
    value.every((item, index) => item === index + 1)
  );
}

const PROGRESS_STATUSES = VIDEO_JOB_STATUSES;

/** Keys arrive over JSON as numeric strings (object keys are always strings); each must resolve to a
 * valid scene number and every value must be a non-empty failure code string. */
function isSceneErrorMap(value: unknown): value is Partial<Record<SceneNumber, string>> {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, message]) => isSceneNumber(Number(key)) && isNonEmptyString(message));
}

/**
 * `paidProvider` is checked first and by type, not merely read.
 *
 * The field is required precisely so that "missing" can never be read as "free" — a real paid run omits its
 * cost line when the budget ledger cannot be read, and the screen used to infer free from that. A guard that
 * skips it puts the inference back in a worse place: the value arrives as undefined, the notice reads it as
 * falsy, and the screen tells someone their Runway run costs nothing. The contract's comment and the
 * screen's both say this must be impossible; this is what makes it so.
 */
function isGenerationProgressResponse(value: unknown): value is GenerationProgressResponse {
  return (
    isRecord(value) &&
    typeof value.paidProvider === "boolean" &&
    isNonEmptyString(value.jobId) &&
    (PROGRESS_STATUSES as readonly unknown[]).includes(value.status) &&
    (value.currentSceneNumber === undefined || isSceneNumber(value.currentSceneNumber)) &&
    isSceneNumberArray(value.completedSceneNumbers) &&
    isSceneNumberArray(value.failedSceneNumbers) &&
    isJobSceneNumbers(value.sceneNumbers) &&
    isSceneErrorMap(value.sceneErrors) &&
    // Same field, same reason as the Episode's guard: two of its three values are read out loud in front of a
    // paid button. `local-video-workflow.service.ts` fills this for both pipelines.
    isSceneFailureMap(value.sceneFailures)
  );
}

function isRegenerateVideoResponse(value: unknown): value is RegenerateVideoResponse {
  return (
    isRecord(value) &&
    isGenerationProgressResponse(value) &&
    isSceneNumberArray(value.regeneratedSceneNumbers)
  );
}

/** Both lists are checked: a recovery that says nothing about what it could not fetch is a recovery that looks total. */
function isRecoverVideosResponse(value: unknown): value is RecoverVideosResponse {
  return (
    isRecord(value) &&
    isGenerationProgressResponse(value) &&
    isSceneNumberArray(value.recoveredSceneNumbers) &&
    Array.isArray(value.unrecoverableScenes) &&
    value.unrecoverableScenes.every((one) => isRecord(one) && isSceneNumber(one.sceneNumber) && typeof one.reason === "string")
  );
}

function isProject(value: unknown): value is GetVideoReviewResponse["project"] {
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

function isVideoReview(value: unknown): value is VideoReview {
  return (
    isRecord(value) &&
    isSceneNumber(value.sceneNumber) &&
    (value.status === "pending" || value.status === "approved") &&
    isNonEmptyString(value.updatedAt) &&
    // Optional: omitted entirely when nothing was actually charged for this scene (e.g. local fake mode).
    // A malformed value is rejected rather than displayed — a wrong cost is worse than no cost.
    (value.costUsd === undefined || (typeof value.costUsd === "number" && Number.isFinite(value.costUsd) && value.costUsd >= 0))
  );
}

/** Every review response must carry every scene belonging to the project (2-12, MIN/MAX_SCENE_COUNT), 1..N in order — never fewer, never out of order. */
function isVideoReviewList(value: unknown): value is VideoReview[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_SCENE_COUNT &&
    value.length <= MAX_SCENE_COUNT &&
    value.every((item, index) => isVideoReview(item) && item.sceneNumber === index + 1)
  );
}

function isGetVideoReviewResponse(value: unknown): value is GetVideoReviewResponse {
  return isRecord(value) && isProject(value.project) && isVideoReviewList(value.reviews)
    && isBudgetPreview(value.budget) && isSceneStaleness(value.staleness);
}

function isApproveVideoReviewResponse(value: unknown): value is ApproveVideoReviewResponse {
  return isGetVideoReviewResponse(value);
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
    throw new VideoWorkflowApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    // A 5xx that did not even carry the backend's own error shape means the backend never answered — it is
    // down, restarting, or something in front of it replied. Say that, instead of blaming the response body.
    if (isServerUnavailable(response.status, apiError.code)) {
      throw new VideoWorkflowApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    throw new VideoWorkflowApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!guard(body)) throw new VideoWorkflowApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

const APPROVED_BODY = { approved: true as const };

/**
 * Omits `additionalInstruction` entirely when blank rather than sending an empty string — the contract treats
 * blank as absent, and leaving the key out keeps the request byte-identical to a plain regeneration.
 */
function regenerateBody(additionalInstruction?: string): RegenerateVideoRequest {
  const trimmed = additionalInstruction?.trim();
  return trimmed ? { approved: true, additionalInstruction: trimmed } : { approved: true };
}
const JSON_HEADERS = { "Content-Type": "application/json" };

/** Reads the persisted local-fake sequential progress for one video job — never a provider or merge-program call. */
export function getVideoProgress(projectId: string, jobId: string): Promise<GenerationProgressResponse> {
  return request(API_ROUTES.videoProgress(projectId, jobId), undefined, isGenerationProgressResponse);
}

/** Stops the local fake job before its next scene starts. Already-completed scenes stay saved. */
export function stopVideoGeneration(projectId: string, jobId: string): Promise<GenerationProgressResponse> {
  return request(API_ROUTES.videoStop(projectId, jobId), { method: "POST" }, isGenerationProgressResponse);
}

/** Resumes a stopped local fake job — only the missing scenes are (re)written. */
export function restartVideoGeneration(projectId: string, jobId: string): Promise<GenerationProgressResponse> {
  return request(API_ROUTES.videoRestart(projectId, jobId), { method: "POST" }, isGenerationProgressResponse);
}

/**
 * Explicit, provider-free replacement of one already generated scene video. Must only be
 * called after a second user confirmation, never on the first click.
 */
export function regenerateVideoScene(
  projectId: string,
  jobId: string,
  sceneNumber: SceneNumber,
  additionalInstruction?: string,
): Promise<RegenerateVideoResponse> {
  return request(
    API_ROUTES.videoRegenerate(projectId, jobId, sceneNumber),
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(regenerateBody(additionalInstruction)) },
    isRegenerateVideoResponse,
  );
}

/**
 * Explicit, provider-free replacement of every generated scene video in the job. Must only be
 * called after a second user confirmation, never on the first click.
 */
export function regenerateAllVideoScenes(
  projectId: string,
  jobId: string,
  additionalInstruction?: string,
): Promise<RegenerateVideoResponse> {
  return request(
    API_ROUTES.videoRegenerateAll(projectId, jobId),
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(regenerateBody(additionalInstruction)) },
    isRegenerateVideoResponse,
  );
}

/**
 * Fetches clips Runway already made and already charged for, and writes them where they should have gone.
 *
 * A status read and a download, never a new generation, so nothing is added to the ledger. The Episode side has
 * had this since the bug that lost those bytes was found; a short project runs the same submissions against the
 * same provider and records the same task ids, and had no way back to them.
 */
export function recoverVideos(projectId: string, jobId: string): Promise<RecoverVideosResponse> {
  return request(
    API_ROUTES.videoRecovery(projectId, jobId),
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ approved: true }) },
    isRecoverVideosResponse,
  );
}

export function getVideoReview(projectId: string, jobId: string): Promise<GetVideoReviewResponse> {
  return request(API_ROUTES.videoReview(projectId, jobId), undefined, isGetVideoReviewResponse);
}

/** `cacheBuster` (e.g. a review's `updatedAt`) forces a refetch after a scene is regenerated. */
export function videoReviewContentUrl(projectId: string, sceneNumber: SceneNumber, cacheBuster: string): string {
  return `${API_ROUTES.videoContent(projectId, sceneNumber)}?v=${encodeURIComponent(cacheBuster)}`;
}

/**
 * The approved source still that a scene's video was generated from. Shown beside the clip during review so the
 * user can judge the result against its input, as the product spec requires.
 */
export function sceneImageContentUrl(projectId: string, sceneNumber: SceneNumber): string {
  return API_ROUTES.imageContent(projectId, sceneNumber);
}

/** A review action is deliberately explicit and cannot be inferred from navigation. */
export function approveVideoReview(
  projectId: string,
  jobId: string,
  sceneNumber: SceneNumber,
): Promise<ApproveVideoReviewResponse> {
  return request(
    API_ROUTES.videoReviewApproval(projectId, jobId, sceneNumber),
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(APPROVED_BODY) },
    isApproveVideoReviewResponse,
  );
}
