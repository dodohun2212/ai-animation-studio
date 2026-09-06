import {
  API_ROUTES,
  type ArchivedLongProjectSummary,
  type ArchivedProjectSummary,
  type DeleteArchivedProjectRequest,
  type DeleteArchivedProjectResponse,
  type ListArchivedLongProjectsResponse,
  type ListArchivedProjectsResponse,
  type RestoreProjectResponse,
} from "@ai-animation-studio/shared";
import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

export class ArchiveApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ArchiveApiError";
    this.code = code;
    this.details = details;
  }
}

// Fixed, safe Korean messages per known backend code — the backend's own message/details text is
// never surfaced to the user (same principle as the other api modules since Round 2).
const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요. 완전 삭제는 프로젝트의 주제/제목을 정확히 입력해야 합니다.",
  PROJECT_NOT_FOUND: "보관함에서 해당 프로젝트를 찾을 수 없습니다. 목록을 새로고침해 주세요.",
  LONG_PROJECT_NOT_FOUND: "보관함에서 해당 장기 프로젝트를 찾을 수 없습니다. 목록을 새로고침해 주세요.",
  PROJECT_RESTORE_COLLISION: "같은 ID의 활성 프로젝트가 이미 있어 복구할 수 없습니다. 활성 프로젝트를 먼저 보관하거나 정리해 주세요.",
  LONG_PROJECT_RESTORE_COLLISION: "같은 ID의 활성 장기 프로젝트가 이미 있어 복구할 수 없습니다. 활성 프로젝트를 먼저 보관하거나 정리해 주세요.",
  PROJECT_STORAGE_ERROR: "보관함 저장소에 접근하지 못했습니다.",
  LONG_PROJECT_STORAGE_ERROR: "장기 프로젝트 보관함 저장소에 접근하지 못했습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Maps any thrown error to a fixed, safe display shape — raw backend text is never shown. */
export function toArchiveDisplayError(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveApiError) {
    if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
    if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
    return { code: error.code, message: SAFE_ERRORS[error.code] ?? UNKNOWN.message };
  }
  return UNKNOWN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isArchivedProjectSummary(value: unknown): value is ArchivedProjectSummary {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.topic === "string" &&
    isNonEmptyString(value.projectType) &&
    isNonEmptyString(value.workflowState) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    isNonEmptyString(value.archivedAt)
  );
}

function isArchivedLongProjectSummary(value: unknown): value is ArchivedLongProjectSummary {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.title === "string" &&
    typeof value.logline === "string" &&
    typeof value.episodeCount === "number" &&
    (value.outlineStatus === "planned" || value.outlineStatus === "outline_ready") &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    isNonEmptyString(value.archivedAt)
  );
}

function isListArchivedProjectsResponse(value: unknown): value is ListArchivedProjectsResponse {
  return isRecord(value) && Array.isArray(value.projects) && value.projects.every(isArchivedProjectSummary);
}

function isListArchivedLongProjectsResponse(value: unknown): value is ListArchivedLongProjectsResponse {
  return isRecord(value) && Array.isArray(value.projects) && value.projects.every(isArchivedLongProjectSummary);
}

function isRestoreProjectResponse(value: unknown): value is RestoreProjectResponse {
  return isRecord(value) && isNonEmptyString(value.restoredProjectId);
}

function isDeleteArchivedProjectResponse(value: unknown): value is DeleteArchivedProjectResponse {
  return isRecord(value) && isNonEmptyString(value.deletedProjectId);
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function requestJson<T>(
  input: string,
  init: RequestInit | undefined,
  isValidResponse: (body: unknown) => body is T,
): Promise<T> {
  let response: Response;
  try {
    response = init ? await fetch(input, init) : await fetch(input);
  } catch {
    throw new ArchiveApiError(NETWORK.code, NETWORK.message);
  }

  const body = await readJsonBody(response);

  if (!response.ok) {
    const carriedCode = isRecord(body) && isNonEmptyString(body.code) ? body.code : MALFORMED.code;
    // A 5xx that did not even carry the backend's own error shape means the backend never answered — it is
    // down, restarting, or something in front of it replied. Say that, instead of blaming the response body.
    if (isServerUnavailable(response.status, carriedCode)) {
      throw new ArchiveApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    if (isRecord(body) && isNonEmptyString(body.code)) {
      throw new ArchiveApiError(body.code, SAFE_ERRORS[body.code] ?? UNKNOWN.message, isRecord(body.details) ? body.details : undefined);
    }
    throw new ArchiveApiError(MALFORMED.code, MALFORMED.message);
  }

  if (!isValidResponse(body)) {
    throw new ArchiveApiError(MALFORMED.code, MALFORMED.message);
  }

  return body;
}

export function listArchivedProjects(): Promise<ListArchivedProjectsResponse> {
  return requestJson(API_ROUTES.projectsArchived, undefined, isListArchivedProjectsResponse);
}

export function listArchivedLongProjects(): Promise<ListArchivedLongProjectsResponse> {
  return requestJson(API_ROUTES.longProjectsArchived, undefined, isListArchivedLongProjectsResponse);
}

export function restoreProject(projectId: string): Promise<RestoreProjectResponse> {
  return requestJson(API_ROUTES.projectRestore(projectId), { method: "POST" }, isRestoreProjectResponse);
}

export function restoreLongProject(projectId: string): Promise<RestoreProjectResponse> {
  return requestJson(API_ROUTES.longProjectRestore(projectId), { method: "POST" }, isRestoreProjectResponse);
}

/** Irreversibly deletes an archived short project's files; requires the exact topic as confirmation. */
export function deleteArchivedProject(projectId: string, request: DeleteArchivedProjectRequest): Promise<DeleteArchivedProjectResponse> {
  return requestJson(
    API_ROUTES.projectArchive(projectId),
    { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    isDeleteArchivedProjectResponse,
  );
}

/** Irreversibly deletes an archived long project's files; requires the exact title as confirmation. */
export function deleteArchivedLongProject(projectId: string, request: DeleteArchivedProjectRequest): Promise<DeleteArchivedProjectResponse> {
  return requestJson(
    API_ROUTES.longProjectArchive(projectId),
    { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    isDeleteArchivedProjectResponse,
  );
}
