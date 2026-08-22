import {
  API_ROUTES,
  type ApproveLongProjectOutlineRequest,
  type ApproveLongProjectOutlineResponse,
  type CreateLongProjectOutlinePreviewResponse,
  type CreateLongProjectRequest,
  type CreateLongProjectResponse,
  type GetLongProjectResponse,
  type GetLongProjectSettingsResponse,
  type ListLongProjectsResponse,
  type LongEpisodeOutline,
  type LongProject,
  type LongProjectSettings,
  type LongProjectSummary,
  type UpdateLongProjectSettingsRequest,
  type UpdateLongProjectSettingsResponse,
} from "@ai-animation-studio/shared";

export class LongProjectsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "LongProjectsApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요.",
  UNSAFE_PROJECT_ID: "프로젝트 ID는 문자, 숫자, '_', '-'만 사용할 수 있습니다.",
  LONG_PROJECT_NOT_FOUND: "장기 프로젝트를 찾을 수 없습니다.",
  LONG_PROJECT_ALREADY_EXISTS: "이미 존재하는 장기 프로젝트 ID입니다.",
  LONG_PROJECT_JSON_MALFORMED: "장기 프로젝트 데이터를 해석하지 못했습니다.",
  LONG_PROJECT_DATA_INVALID: "장기 프로젝트 데이터가 올바르지 않습니다.",
  LONG_PROJECT_STORAGE_ERROR: "장기 프로젝트 저장소에 접근하지 못했습니다.",
  LONG_OUTLINE_STALE: "아웃라인 프롬프트가 그 사이에 변경되었습니다. 미리보기를 다시 불러와 주세요.",
  LONG_OUTLINE_NOT_ALLOWED: "아웃라인 승인은 아직 생성되지 않은 프로젝트에서만 가능합니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toLongProjectDisplayError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (!(error instanceof LongProjectsApiError)) return UNKNOWN;
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

const PLATFORMS = new Set(["YouTube Shorts", "YouTube"]);
const ASPECT_RATIOS = new Set(["9:16", "16:9"]);
const OUTLINE_STATUSES = new Set(["planned", "outline_ready"]);

function isLongProjectSettings(value: unknown): value is LongProjectSettings {
  if (!isRecord(value)) return false;
  const stringKeys = [
    "title", "logline", "overview", "genre", "tone", "theme",
    "audience", "notes", "startingState", "midpoint", "endingDirection", "storyFlowSummary",
  ];
  if (!stringKeys.every((key) => typeof value[key] === "string")) return false;
  if (!Number.isInteger(value.episodeCount) || (value.episodeCount as number) <= 0) return false;
  if (!Number.isInteger(value.episodeDurationSeconds) || (value.episodeDurationSeconds as number) <= 0) return false;
  if (!PLATFORMS.has(value.platform as string)) return false;
  if (!ASPECT_RATIOS.has(value.aspectRatio as string)) return false;
  return true;
}

function isLongProjectSummary(value: unknown): value is LongProjectSummary {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.title === "string" &&
    typeof value.logline === "string" &&
    Number.isInteger(value.episodeCount) &&
    OUTLINE_STATUSES.has(value.outlineStatus as string) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
}

function isLongEpisodeOutline(value: unknown): value is LongEpisodeOutline {
  return (
    isRecord(value) &&
    Number.isInteger(value.episodeNumber) &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.mainEvent === "string" &&
    typeof value.conflict === "string" &&
    typeof value.cliffhanger === "string" &&
    typeof value.nextEpisodeHook === "string" &&
    OUTLINE_STATUSES.has(value.status as string)
  );
}

function isLongProject(value: unknown): value is LongProject {
  if (!isLongProjectSummary(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return (
    isLongProjectSettings(record.settings) &&
    isRecord(record.storyBible) &&
    Array.isArray(record.episodes) &&
    (record.episodes as unknown[]).every(isLongEpisodeOutline)
  );
}

function isCreateLongProjectResponse(value: unknown): value is CreateLongProjectResponse {
  return isRecord(value) && isLongProject(value.project);
}

function isListLongProjectsResponse(value: unknown): value is ListLongProjectsResponse {
  return isRecord(value) && Array.isArray(value.projects) && value.projects.every(isLongProjectSummary);
}

function isGetLongProjectResponse(value: unknown): value is GetLongProjectResponse {
  return isRecord(value) && isLongProject(value.project);
}

function isGetLongProjectSettingsResponse(value: unknown): value is GetLongProjectSettingsResponse {
  return isRecord(value) && isLongProjectSettings(value.settings);
}

function isUpdateLongProjectSettingsResponse(value: unknown): value is UpdateLongProjectSettingsResponse {
  return isRecord(value) && isLongProject(value.project);
}

function isPreviewResponse(value: unknown): value is CreateLongProjectOutlinePreviewResponse {
  if (!isRecord(value) || !isRecord(value.preview)) return false;
  const preview = value.preview;
  return (
    isNonEmptyString(preview.projectId) &&
    typeof preview.prompt === "string" &&
    isDigest(preview.promptSha256) &&
    Number.isInteger(preview.episodeCount)
  );
}

function isApprovalResponse(value: unknown): value is ApproveLongProjectOutlineResponse {
  return (
    isRecord(value) &&
    isLongProject(value.project) &&
    isNonEmptyString(value.approvedAt) &&
    isDigest(value.promptSha256) &&
    typeof value.modified === "boolean"
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
    throw new LongProjectsApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new LongProjectsApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!guard(body)) throw new LongProjectsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

export function createLongProject(requestBody: CreateLongProjectRequest): Promise<CreateLongProjectResponse> {
  return request(
    API_ROUTES.longProjects,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isCreateLongProjectResponse,
  );
}

export function listLongProjects(): Promise<ListLongProjectsResponse> {
  return request(API_ROUTES.longProjects, undefined, isListLongProjectsResponse);
}

export function getLongProject(projectId: string): Promise<GetLongProjectResponse> {
  return request(API_ROUTES.longProject(projectId), undefined, isGetLongProjectResponse);
}

export function getLongProjectSettings(projectId: string): Promise<GetLongProjectSettingsResponse> {
  return request(API_ROUTES.longProjectSettings(projectId), undefined, isGetLongProjectSettingsResponse);
}

export function updateLongProjectSettings(
  projectId: string,
  requestBody: UpdateLongProjectSettingsRequest,
): Promise<UpdateLongProjectSettingsResponse> {
  return request(
    API_ROUTES.longProjectSettings(projectId),
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isUpdateLongProjectSettingsResponse,
  );
}

/** Local-only preview of the exact outline request text — never calls a paid provider. */
export function createLongProjectOutlinePreview(projectId: string): Promise<CreateLongProjectOutlinePreviewResponse> {
  return request(API_ROUTES.longProjectOutlinePreview(projectId), { method: "POST" }, isPreviewResponse);
}

export function approveLongProjectOutline(
  projectId: string,
  requestBody: ApproveLongProjectOutlineRequest,
): Promise<ApproveLongProjectOutlineResponse> {
  return request(
    API_ROUTES.longProjectOutlineApproval(projectId),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isApprovalResponse,
  );
}
