import {
  API_ROUTES,
  type GetVideoLibraryResponse,
  type GetVideoVersionsResponse,
  type RestoreVideoVersionResponse,
  type SceneNumber,
  type VideoLibraryProjectSummary,
  type VideoVersionSummary,
} from "@ai-animation-studio/shared";

export class VideoLibraryApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VideoLibraryApiError";
    this.code = code;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  VIDEO_VERSION_NOT_FOUND: "이 버전을 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요.",
  VIDEO_RESTORE_NOT_ALLOWED: "현재 프로젝트 상태에서는 되돌릴 수 없습니다.",
  VIDEO_STORAGE_ERROR: "영상 파일을 읽고 쓰는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  VIDEO_MERGE_CONTENT_UNAVAILABLE: "영상을 불러올 수 없습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or any filesystem path — only a fixed, safe message per code. */
export function toVideoLibraryDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof VideoLibraryApiError)) return UNKNOWN;
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

/**
 * A cost is rendered as money, so a non-finite or negative number is rejected rather than displayed: a card
 * reading "$NaN" or "$-1.50" beside a real spend figure would make every other number on the page suspect.
 */
function isCostUsd(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isAspectRatio(value: unknown): value is "9:16" | "16:9" {
  return value === "9:16" || value === "16:9";
}

function isLibraryProject(value: unknown): value is VideoLibraryProjectSummary {
  return (
    isRecord(value)
    && isNonEmptyString(value.projectId)
    && typeof value.topic === "string"
    && isNonEmptyString(value.updatedAt)
    && isCount(value.sceneCount)
    && isCount(value.videosReadyCount)
    && typeof value.finalVideoAvailable === "boolean"
    && isCostUsd(value.totalActualCostUsd)
    && isAspectRatio(value.aspectRatio)
  );
}

function isVersion(value: unknown): value is VideoVersionSummary {
  return (
    isRecord(value)
    && isNonEmptyString(value.versionId)
    && isNonEmptyString(value.createdAt)
    && isCount(value.bytes)
    && typeof value.isCurrent === "boolean"
  );
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toApiErrorShape(body: unknown): { code: string; message: string } {
  if (isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)) {
    return { code: body.code, message: body.message };
  }
  return MALFORMED;
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new VideoLibraryApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new VideoLibraryApiError(apiError.code, apiError.message);
  }
  return body;
}

/** Read-only listing of every short project that has at least one generated scene video. Never charges anything. */
export async function getVideoLibrary(): Promise<GetVideoLibraryResponse> {
  const body = await request(API_ROUTES.videoLibrary);
  if (!isRecord(body) || !Array.isArray(body.projects) || !body.projects.every(isLibraryProject)) {
    throw new VideoLibraryApiError(MALFORMED.code, MALFORMED.message);
  }
  return { projects: body.projects };
}

/** Every stored copy of one scene's video, or of the final merged video. Read-only; never charges anything. */
export async function getVideoVersions(projectId: string, scene: SceneNumber | "final"): Promise<GetVideoVersionsResponse> {
  const body = await request(API_ROUTES.videoVersions(projectId, scene));
  if (!isRecord(body) || !Array.isArray(body.versions) || !body.versions.every(isVersion)) {
    throw new VideoLibraryApiError(MALFORMED.code, MALFORMED.message);
  }
  return { versions: body.versions };
}

/**
 * Promotes a past version back to current. Free — a local file move, never a provider call — but it does change
 * which bytes the project serves, so callers must gate it behind an explicit confirmation the same way a paid
 * action is gated. `approved: true` mirrors the other confirm-then-act endpoints in this app.
 */
export async function restoreVideoVersion(
  projectId: string,
  scene: SceneNumber | "final",
  versionId: string,
): Promise<RestoreVideoVersionResponse> {
  const body = await request(API_ROUTES.videoVersionRestore(projectId, scene, versionId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approved: true }),
  });
  if (!isRecord(body) || !isRecord(body.project) || !isNonEmptyString(body.project.id)) {
    throw new VideoLibraryApiError(MALFORMED.code, MALFORMED.message);
  }
  return body as unknown as RestoreVideoVersionResponse;
}

/** Playback URL for one stored version. The element requesting it does the fetching, so this never throws. */
export function videoVersionContentUrl(projectId: string, scene: SceneNumber | "final", versionId: string): string {
  return API_ROUTES.videoVersionContent(projectId, scene, versionId);
}
