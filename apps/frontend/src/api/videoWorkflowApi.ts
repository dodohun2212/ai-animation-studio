import { VIDEO_JOB_STATUSES,
  VIDEO_MODELS,
  SCENE_REVIEW_STATUSES,
  API_ROUTES,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  isAspectRatio,
  type ApproveVideoReviewResponse,
  type GenerationProgressResponse,
  type GetVideoReviewResponse,
  type RecoverVideosResponse,
  type RegenerateVideoRequest,
  type RegenerateVideoResponse,
  type SceneNumber,
  type VideoReview,
} from "@ai-animation-studio/shared";
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
  /* The app declining to spend money on a repeat of a known failure. The catch-all says "잠시 후 다시 시도해
     주세요", which here means "pay $0.50 for the same failure again" — 2026-09-05 is when that was paid twice.
     The screen normally keeps the button shut when `remedy = change_input`, so arriving here at all means that
     guard was bypassed; that is exactly the moment the sentence has to name what to do. */
  VIDEO_RETRY_NEEDS_CHANGED_INPUT: "이 장면은 입력이 원인이라 그대로 다시 만들면 똑같이 실패합니다. 무엇을 바꿀지 적은 뒤에 다시 눌러 주세요.",
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

/**
 * 한 장면이 실패했을 때의 문장 — 표와 조립기는 `runwaySceneError.ts` 한 곳에 있습니다.
 *
 * 이 파일과 `longProjectsApi.ts` 가 같은 표를 각자 손으로 들고 있었고, 주석은 「똑같은 독립
 * 사본」이라고 말했지만 두 칸이 한쪽에만 있었습니다 — 크레딧 부족과 「다시 보내지 마라」. 백엔드는
 * 두 파이프라인에 **한 분류기**로 답하므로, 이쪽도 한 표로 답합니다. 이름만 여기 남깁니다(부르는 곳이
 * 두 화면으로 갈려 있고, 그 갈림은 이 모듈들이 말하는 것이 맞습니다).
 */
export { runwaySceneErrorMessage as sceneErrorMessage } from "./runwaySceneError.js";

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
    isSceneFailureMap(value.sceneFailures) &&
    // Required, not optional — a project's shape cannot change once it has pictures, so this is always known.
    // A missing/invalid value here used to fall back to a hardcoded portrait box for the whole run, which is
    // what a landscape project's generation screen showed throughout (Cowork Round 865/867).
    isAspectRatio(value.aspectRatio) &&
    /* 🔴 Required for the same reason as `aspectRatio` above, and checked against the contract's own list
       rather than merely typed as a string. This is what the failure line names when a clip fails: with twenty
       models in the catalogue from five makers, 「Runway 크레딧이 부족합니다」 alone never says *which model*
       to change — true about the billing, useless about the failure. A response that cannot say which model
       this job used is one this screen must not draw, because the sentence it would print is the old one. */
    (VIDEO_MODELS as readonly string[]).includes(value.model as string)
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
    /* The contract already publishes this list; a guard that retypes it is a second copy that nothing
       keeps in step. Add a value to the contract and this guard silently REJECTS it — the response
       parses as malformed and the screen shows nothing, with no compile error anywhere. Same defect
       family as the outlineStatus label table (00_NOW.md ④), and the same fix: read the list. */
    (SCENE_REVIEW_STATUSES as readonly string[]).includes(value.status as string) &&
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
