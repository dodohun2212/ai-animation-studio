import {
  API_ROUTES,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type GetProjectResponse,
  type ListProjectsResponse,
  type Project,
  type ProjectSummary,
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

/** Never surfaces raw body content, stack traces, or local paths — only a fixed, safe message. */
export function toDisplayError(error: unknown): { code: string; message: string } {
  if (error instanceof ProjectsApiError) {
    return { code: error.code, message: error.message };
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
    Array.isArray((value as { errors?: unknown }).errors)
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
