import {
  API_ROUTES,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  RUNWAY_CLIP_DURATIONS,
  type ArchiveProjectRequest,
  type ArchiveProjectResponse,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type GetProjectResponse,
  type GetProjectSettingsResponse,
  type GetShortProjectAssetReferencesResponse,
  type GetShortProjectCastResponse,
  type GetShortProjectContinuityResponse,
  type ListProjectsResponse,
  type ListShortProjectContinuityOptionsResponse,
  type Project,
  type ProjectSummary,
  type SetShortProjectContinuityRequest,
  type SetShortProjectContinuityResponse,
  type ShortProjectCastMember,
  type ShortProjectContinuityOption,
  type ShortProjectSceneReferenceAsset,
  type ShortProjectSettings,
  type UpdateProjectSettingsRequest,
  type UpdateProjectSettingsResponse,
  type UpdateShortProjectAssetReferencesRequest,
  type UpdateShortProjectAssetReferencesResponse,
  type UpdateShortProjectCastRequest,
  type UpdateShortProjectCastResponse,
} from "@ai-animation-studio/shared";

export class ProjectsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ProjectsApiError";
    this.code = code;
    this.details = details;
  }
}

const NETWORK_ERROR = { code: "CLIENT_NETWORK_ERROR", message: "서버에 연결하지 못했습니다. 네트워크 상태를 확인해주세요." };
const MALFORMED_RESPONSE_ERROR = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 해석하지 못했습니다." };
const UNKNOWN_ERROR = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." };

/**
 * Every non-INVALID_REQUEST code apps/backend/src/projects/project-api.error.ts can throw (audited against
 * every throw site under apps/backend/src/projects/ — projects.service.ts, project-settings.ts, project-cast.ts,
 * project-asset-references.ts, project-storage.schema.ts, projects.repository.ts, scene-edit.service.ts — this
 * module's own toApiProject-backed endpoints are the only ones that can produce these).
 */
const SAFE_ERRORS: Record<string, string> = {
  UNSAFE_PROJECT_ID: "프로젝트 ID에 사용할 수 없는 문자가 포함되어 있습니다.",
  PROJECT_ALREADY_EXISTS: "이미 같은 이름의 프로젝트가 있습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  PROJECT_JSON_MALFORMED: "프로젝트 데이터를 읽을 수 없습니다.",
  PROJECT_DATA_INVALID: "프로젝트 데이터가 손상되었습니다.",
  PROJECT_STORAGE_ERROR: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  PROJECT_ARCHIVE_NOT_ALLOWED: "생성 또는 렌더링이 진행 중인 프로젝트는 보관할 수 없습니다.",
  PROJECT_ARCHIVE_COLLISION: "이미 복구 가능한 보관 항목이 있습니다. 먼저 정리해 주세요.",
  PROJECT_RESTORE_COLLISION: "같은 위치에 이미 활성 프로젝트가 있어 복구할 수 없습니다.",
};

/**
 * INVALID_REQUEST alone covers many different situations across every endpoint this module calls (settings
 * validation, cast/asset-reference validation, archive/delete confirmation mismatch, continuity linking, ...),
 * each throw site's own message an internal English string never meant for display. Rather than one generic
 * message for all of them (losing real, actionable distinctions a couple of these carry — a mistyped archive
 * confirmation is not the same situation as an unavailable Asset), `details.field` (already sent by every
 * invalidRequest() call site) picks the closer message; anything else falls back to a generic one.
 */
const CONFIRMATION_MISMATCH_MESSAGE = "확인 문구가 프로젝트 제목과 일치하지 않습니다.";
const ASSET_SELECTION_INVALID_MESSAGE = "선택한 Asset을 찾을 수 없거나 이 용도로 사용할 수 없는 유형입니다.";
const INVALID_REQUEST_FALLBACK_MESSAGE = "입력값을 확인해 주세요.";
const ASSET_FIELD_PREFIXES = ["assetId", "atmosphereAssetIds", "sceneReferenceAssets", "cast"];

function invalidRequestMessage(details: Record<string, unknown> | undefined): string {
  const field = typeof details?.field === "string" ? details.field : "";
  if (field === "confirmation") return CONFIRMATION_MISMATCH_MESSAGE;
  if (ASSET_FIELD_PREFIXES.some((prefix) => field === prefix || field.startsWith(`${prefix}[`) || field.startsWith(`${prefix}.`))) {
    return ASSET_SELECTION_INVALID_MESSAGE;
  }
  return INVALID_REQUEST_FALLBACK_MESSAGE;
}

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code (or, for INVALID_REQUEST, per details.field). */
export function toDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof ProjectsApiError)) return UNKNOWN_ERROR;
  if (error.code === "INVALID_REQUEST") {
    return { code: error.code, message: invalidRequestMessage(error.details) };
  }
  // These two are thrown by this module itself (see NETWORK_ERROR/MALFORMED_RESPONSE_ERROR above) with an
  // already-safe, already-Korean message — never the backend's own text — so passing them through as-is is
  // correct, not an exception to "never surfaces the backend's raw message."
  if (error.code === NETWORK_ERROR.code) return NETWORK_ERROR;
  if (error.code === MALFORMED_RESPONSE_ERROR.code) return MALFORMED_RESPONSE_ERROR;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  return UNKNOWN_ERROR;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Backend errors are `{ code, message, details? }`; anything else falls back to a safe, generic shape. */
function toApiErrorShape(body: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)) {
    const details = isRecord(body.details) ? body.details : undefined;
    return details ? { code: body.code, message: body.message, details } : { code: body.code, message: body.message };
  }
  return MALFORMED_RESPONSE_ERROR;
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.topic === "string" &&
    isNonEmptyString(value.projectType) &&
    isNonEmptyString(value.workflowState) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
}

function isProject(value: unknown): value is Project {
  return (
    isProjectSummary(value) &&
    Array.isArray((value as { scenes?: unknown }).scenes) &&
    Array.isArray((value as { warnings?: unknown }).warnings) &&
    Array.isArray((value as { errors?: unknown }).errors) &&
    ((value as { currentVideoJobId?: unknown }).currentVideoJobId === undefined || typeof (value as { currentVideoJobId?: unknown }).currentVideoJobId === "string")
  );
}

function isCreateProjectResponse(value: unknown): value is CreateProjectResponse {
  return isRecord(value) && isProject(value.project);
}

function isListProjectsResponse(value: unknown): value is ListProjectsResponse {
  return isRecord(value) && Array.isArray(value.projects) && value.projects.every(isProjectSummary);
}

function isGetProjectResponse(value: unknown): value is GetProjectResponse {
  return isRecord(value) && isProject(value.project);
}

function isShortProjectSettings(value: unknown): value is ShortProjectSettings {
  if (
    !isRecord(value) ||
    typeof value.sceneCount !== "number" ||
    !Number.isInteger(value.sceneCount) ||
    value.sceneCount < MIN_SCENE_COUNT ||
    value.sceneCount > MAX_SCENE_COUNT ||
    !(RUNWAY_CLIP_DURATIONS as readonly number[]).includes(value.clipDurationSeconds as number) ||
    !Number.isInteger(value.durationSeconds) ||
    (value.durationSeconds as number) <= 0 ||
    typeof value.narrationEnabled !== "boolean" ||
    typeof value.subtitlesEnabled !== "boolean"
  ) {
    return false;
  }
  const stringKeys = ["projectName", "topic", "genre", "mood", "character", "lore", "fullStory", "additionalNotes"];
  if (!stringKeys.every((key) => typeof value[key] === "string") || !isRecord(value.styleNotes)) return false;
  const allowedStyleKeys = ["visualStyle", "color", "lighting", "camera", "dialogue", "avoid", "aspect"];
  return Object.entries(value.styleNotes).every(([key, item]) => allowedStyleKeys.includes(key) && typeof item === "string");
}

function isGetProjectSettingsResponse(value: unknown): value is GetProjectSettingsResponse {
  return isRecord(value) && isShortProjectSettings(value.settings);
}

function isUpdateProjectSettingsResponse(value: unknown): value is UpdateProjectSettingsResponse {
  return isRecord(value) && isProject(value.project) && isShortProjectSettings(value.settings);
}

function isArchiveProjectResponse(value: unknown): value is ArchiveProjectResponse {
  return isRecord(value) && isNonEmptyString(value.archivedProjectId);
}

function isShortProjectCastMember(value: unknown): value is ShortProjectCastMember {
  return isRecord(value) && isNonEmptyString(value.assetId) && isNonEmptyString(value.castRole) && isNonEmptyString(value.storyRole);
}

function isGetShortProjectCastResponse(value: unknown): value is GetShortProjectCastResponse {
  return isRecord(value) && Array.isArray(value.cast) && value.cast.every(isShortProjectCastMember);
}

function isUpdateShortProjectCastResponse(value: unknown): value is UpdateShortProjectCastResponse {
  return isRecord(value) && Array.isArray(value.cast) && value.cast.every(isShortProjectCastMember);
}

function isShortProjectSceneReferenceAsset(value: unknown): value is ShortProjectSceneReferenceAsset {
  return isRecord(value) && isNonEmptyString(value.assetId) && isNonEmptyString(value.purpose);
}

function isGetShortProjectAssetReferencesResponse(value: unknown): value is GetShortProjectAssetReferencesResponse {
  return isRecord(value)
    && Array.isArray(value.atmosphereAssetIds) && value.atmosphereAssetIds.every((item) => typeof item === "string")
    && Array.isArray(value.sceneReferenceAssets) && value.sceneReferenceAssets.every(isShortProjectSceneReferenceAsset);
}

function isUpdateShortProjectAssetReferencesResponse(value: unknown): value is UpdateShortProjectAssetReferencesResponse {
  return isGetShortProjectAssetReferencesResponse(value);
}

function isShortProjectContinuityOption(value: unknown): value is ShortProjectContinuityOption {
  return isRecord(value) && isNonEmptyString(value.projectId) && isNonEmptyString(value.projectName) && isNonEmptyString(value.label);
}

function isListShortProjectContinuityOptionsResponse(value: unknown): value is ListShortProjectContinuityOptionsResponse {
  return isRecord(value) && Array.isArray(value.options) && value.options.every(isShortProjectContinuityOption);
}

function isGetShortProjectContinuityResponse(value: unknown): value is GetShortProjectContinuityResponse {
  return isRecord(value) && (value.link === null || isShortProjectContinuityOption(value.link));
}

function isSetShortProjectContinuityResponse(value: unknown): value is SetShortProjectContinuityResponse {
  return isGetShortProjectContinuityResponse(value);
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
    throw new ProjectsApiError(NETWORK_ERROR.code, NETWORK_ERROR.message);
  }

  const body = await readJsonBody(response);

  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new ProjectsApiError(apiError.code, apiError.message, apiError.details);
  }

  if (!isValidResponse(body)) {
    throw new ProjectsApiError(MALFORMED_RESPONSE_ERROR.code, MALFORMED_RESPONSE_ERROR.message);
  }

  return body;
}

export async function createProject(request: CreateProjectRequest): Promise<CreateProjectResponse> {
  return requestJson(
    API_ROUTES.projects,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    isCreateProjectResponse,
  );
}

export async function listProjects(): Promise<ListProjectsResponse> {
  return requestJson(API_ROUTES.projects, undefined, isListProjectsResponse);
}

export async function getProject(projectId: string): Promise<GetProjectResponse> {
  return requestJson(API_ROUTES.project(projectId), undefined, isGetProjectResponse);
}

export async function getProjectSettings(projectId: string): Promise<GetProjectSettingsResponse> {
  return requestJson(API_ROUTES.projectSettings(projectId), undefined, isGetProjectSettingsResponse);
}

export async function updateProjectSettings(
  projectId: string,
  request: UpdateProjectSettingsRequest,
): Promise<UpdateProjectSettingsResponse> {
  return requestJson(
    API_ROUTES.projectSettings(projectId),
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    isUpdateProjectSettingsResponse,
  );
}

export async function getProjectCast(projectId: string): Promise<GetShortProjectCastResponse> {
  return requestJson(API_ROUTES.projectCast(projectId), undefined, isGetShortProjectCastResponse);
}

export async function updateProjectCast(
  projectId: string,
  request: UpdateShortProjectCastRequest,
): Promise<UpdateShortProjectCastResponse> {
  return requestJson(
    API_ROUTES.projectCast(projectId),
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    isUpdateShortProjectCastResponse,
  );
}

export async function getProjectAssetReferences(projectId: string): Promise<GetShortProjectAssetReferencesResponse> {
  return requestJson(API_ROUTES.projectAssetReferences(projectId), undefined, isGetShortProjectAssetReferencesResponse);
}

export async function updateProjectAssetReferences(
  projectId: string,
  request: UpdateShortProjectAssetReferencesRequest,
): Promise<UpdateShortProjectAssetReferencesResponse> {
  return requestJson(
    API_ROUTES.projectAssetReferences(projectId),
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    isUpdateShortProjectAssetReferencesResponse,
  );
}

export async function listProjectContinuityOptions(projectId: string): Promise<ListShortProjectContinuityOptionsResponse> {
  return requestJson(API_ROUTES.projectContinuityOptions(projectId), undefined, isListShortProjectContinuityOptionsResponse);
}

export async function getProjectContinuity(projectId: string): Promise<GetShortProjectContinuityResponse> {
  return requestJson(API_ROUTES.projectContinuity(projectId), undefined, isGetShortProjectContinuityResponse);
}

export async function setProjectContinuity(
  projectId: string,
  request: SetShortProjectContinuityRequest,
): Promise<SetShortProjectContinuityResponse> {
  return requestJson(
    API_ROUTES.projectContinuity(projectId),
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    isSetShortProjectContinuityResponse,
  );
}

export async function archiveProject(
  projectId: string,
  request: ArchiveProjectRequest,
): Promise<ArchiveProjectResponse> {
  return requestJson(
    API_ROUTES.projectArchive(projectId),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    isArchiveProjectResponse,
  );
}
