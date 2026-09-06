import {
  API_ROUTES,
  type Project,
  type SceneNumber,
  type SceneStaleness,
  type UpdateSceneRequest,
  type UpdateSceneResponse,
} from "@ai-animation-studio/shared";
import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

export class SceneEditApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SceneEditApiError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Fixed Korean messages per code. The scene-edit endpoint's own `INVALID_REQUEST` messages name internals
 * (field lists, "Scene data is invalid.") in English, so they are never shown — the UI only ever prevents or
 * explains, it does not relay. Mirrors the imageReview/narration modules rather than projectsApi, whose
 * `toDisplayError` passes the backend message straight through.
 */
const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "장면 내용을 저장하지 못했습니다. 입력한 내용을 다시 확인해 주세요.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  UNSAFE_PROJECT_ID: "프로젝트를 찾을 수 없습니다.",
  PROJECT_STORAGE_ERROR: "장면 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

export function toSceneEditDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof SceneEditApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSceneNumberList(value: unknown): value is SceneNumber[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 1);
}

/**
 * Every list the contract requires, not the three this happened to start with.
 *
 * A predicate that skips a field still tells the compiler the whole type is there, so the two it was not
 * looking at reached the screen typed as arrays and valued as undefined — and the image screen narrows those
 * lists with .filter after a regeneration.
 */
function isSceneStaleness(value: unknown): value is SceneStaleness {
  return (
    isRecord(value) &&
    isSceneNumberList(value.imageStale) &&
    isSceneNumberList(value.styleStale) &&
    isSceneNumberList(value.videoStale) &&
    isSceneNumberList(value.videoFormatStale) &&
    isSceneNumberList(value.narrationStale) &&
    isSceneNumberList(value.referenceStale)
  );
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

function isUpdateSceneResponse(value: unknown): value is UpdateSceneResponse {
  return isRecord(value) && isProject(value.project) && isSceneStaleness(value.staleness);
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

/**
 * Saves one scene's edited fields. Only the fields the user actually changed are sent — the endpoint rejects
 * unknown keys, and sending untouched fields back would make an unrelated later schema change look like an edit.
 */
export async function updateScene(
  projectId: string,
  sceneNumber: SceneNumber,
  scene: Record<string, string>,
): Promise<UpdateSceneResponse> {
  const requestBody: UpdateSceneRequest = { scene };
  let response: Response;
  try {
    response = await fetch(API_ROUTES.sceneEdit(projectId, sceneNumber), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch {
    throw new SceneEditApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    // A 5xx that did not even carry the backend's own error shape means the backend never answered — it is
    // down, restarting, or something in front of it replied. Say that, instead of blaming the response body.
    if (isServerUnavailable(response.status, apiError.code)) {
      throw new SceneEditApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    throw new SceneEditApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!isUpdateSceneResponse(body)) throw new SceneEditApiError(MALFORMED.code, MALFORMED.message);
  return body;
}
