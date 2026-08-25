import {
  API_ROUTES,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  type ApproveVideoReviewResponse,
  type GenerationProgressResponse,
  type GetVideoReviewResponse,
  type RegenerateVideoResponse,
  type SceneNumber,
  type VideoReview,
} from "@ai-animation-studio/shared";

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
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toVideoWorkflowDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof VideoWorkflowApiError)) return UNKNOWN;
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

const PROGRESS_STATUSES = ["created", "running", "succeeded", "failed", "interrupted"] as const;

function isGenerationProgressResponse(value: unknown): value is GenerationProgressResponse {
  return (
    isRecord(value) &&
    isNonEmptyString(value.jobId) &&
    (PROGRESS_STATUSES as readonly unknown[]).includes(value.status) &&
    (value.currentSceneNumber === undefined || isSceneNumber(value.currentSceneNumber)) &&
    isSceneNumberArray(value.completedSceneNumbers) &&
    isSceneNumberArray(value.failedSceneNumbers) &&
    isJobSceneNumbers(value.sceneNumbers)
  );
}

function isRegenerateVideoResponse(value: unknown): value is RegenerateVideoResponse {
  return (
    isRecord(value) &&
    isGenerationProgressResponse(value) &&
    isSceneNumberArray(value.regeneratedSceneNumbers)
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
    isNonEmptyString(value.updatedAt)
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
  return isRecord(value) && isProject(value.project) && isVideoReviewList(value.reviews);
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
    throw new VideoWorkflowApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!guard(body)) throw new VideoWorkflowApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

const APPROVED_BODY = { approved: true as const };
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
): Promise<RegenerateVideoResponse> {
  return request(
    API_ROUTES.videoRegenerate(projectId, jobId, sceneNumber),
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(APPROVED_BODY) },
    isRegenerateVideoResponse,
  );
}

/**
 * Explicit, provider-free replacement of every generated scene video in the job. Must only be
 * called after a second user confirmation, never on the first click.
 */
export function regenerateAllVideoScenes(projectId: string, jobId: string): Promise<RegenerateVideoResponse> {
  return request(
    API_ROUTES.videoRegenerateAll(projectId, jobId),
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(APPROVED_BODY) },
    isRegenerateVideoResponse,
  );
}

export function getVideoReview(projectId: string, jobId: string): Promise<GetVideoReviewResponse> {
  return request(API_ROUTES.videoReview(projectId, jobId), undefined, isGetVideoReviewResponse);
}

/** `cacheBuster` (e.g. a review's `updatedAt`) forces a refetch after a scene is regenerated. */
export function videoReviewContentUrl(projectId: string, sceneNumber: SceneNumber, cacheBuster: string): string {
  return `${API_ROUTES.videoContent(projectId, sceneNumber)}?v=${encodeURIComponent(cacheBuster)}`;
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
