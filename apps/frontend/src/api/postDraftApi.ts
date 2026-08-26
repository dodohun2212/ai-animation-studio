import { API_ROUTES, type GetPostDraftResponse, type PostDraft, type PutPostDraftResponse } from "@ai-animation-studio/shared";

export class PostDraftApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PostDraftApiError";
    this.code = code;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  PROJECT_STORAGE_ERROR: "캡션을 저장하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or any filesystem path — only a fixed, safe message per code. */
export function toPostDraftDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof PostDraftApiError)) return UNKNOWN;
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
 * Every field is optional, so this rejects only wrong *types* — a draft that came back with a number where the
 * caption body should be would otherwise be rendered into a textarea and saved back as that number's text.
 */
function isDraft(value: unknown): value is PostDraft {
  return (
    isRecord(value)
    && (value.body === undefined || typeof value.body === "string")
    && (value.hashtags === undefined || typeof value.hashtags === "string")
    && (value.aiNotice === undefined || typeof value.aiNotice === "boolean")
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
    throw new PostDraftApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new PostDraftApiError(apiError.code, apiError.message);
  }
  return body;
}

/** The caption in progress for one project. Local text only — never charges anything, never reaches Instagram. */
export async function getPostDraft(projectId: string): Promise<GetPostDraftResponse> {
  const body = await request(API_ROUTES.projectPostDraft(projectId));
  if (!isDraft(body)) throw new PostDraftApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

/**
 * Replaces the whole draft — the backend does not merge, so callers must send every field they still want kept.
 * The credit line is deliberately not part of this shape: it is read fresh from the project's `usedAudio` each
 * time, so editing or deleting a track can never leave a stale credit sitting in a saved draft.
 */
export async function putPostDraft(projectId: string, draft: PostDraft): Promise<PutPostDraftResponse> {
  const body = await request(API_ROUTES.projectPostDraft(projectId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!isDraft(body)) throw new PostDraftApiError(MALFORMED.code, MALFORMED.message);
  return body;
}
