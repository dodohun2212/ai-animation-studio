import {
  API_ROUTES,
  type GetInstagramTargetsResponse,
  type InstagramPublishTarget,
  type InstagramTargetDiagnostics,
  type SetInstagramTargetResponse,
} from "@ai-animation-studio/shared";

export class InstagramTargetsApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InstagramTargetsApiError";
    this.code = code;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  // Distinct from an empty list on purpose: "log in" and "connect a page" are different things to go do.
  INSTAGRAM_NOT_CONNECTED: "인스타그램에 로그인되어 있지 않습니다. 로그인한 뒤 다시 시도해 주세요.",
  INSTAGRAM_TARGET_NOT_FOUND: "고른 계정을 지금은 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 골라 주세요.",
  INSTAGRAM_PROVIDER_ERROR: "인스타그램에서 요청을 거부했습니다. 잠시 후 다시 시도해 주세요.",
  INSTAGRAM_STORAGE_ERROR: "계정 선택을 저장하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or any Meta error detail — only a fixed, safe message per code. */
export function toInstagramTargetsDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof InstagramTargetsApiError)) return UNKNOWN;
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

function isTarget(value: unknown): value is InstagramPublishTarget {
  return (
    isRecord(value)
    && isNonEmptyString(value.igUserId)
    && isNonEmptyString(value.username)
    && typeof value.pageName === "string"
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The counts behind an empty list. Checked strictly and dropped when wrong rather than shown half-read: this
 * exists to end a guess, and a diagnosis assembled from a malformed body would be a new one.
 */
function isDiagnostics(value: unknown): value is InstagramTargetDiagnostics {
  return isRecord(value)
    && isCount(value.pageCount)
    && isCount(value.pagesWithInstagramAccount)
    && Array.isArray(value.missingPermissions)
    && value.missingPermissions.every((one) => typeof one === "string")
    && typeof value.permissionsChecked === "boolean";
}

function isTargetsResponse(body: unknown): body is GetInstagramTargetsResponse {
  return (
    isRecord(body)
    && Array.isArray(body.targets)
    && body.targets.every(isTarget)
    // Absent is the meaningful "choose again" state, so only a wrong *type* is a malformed response.
    && (body.selectedIgUserId === undefined || isNonEmptyString(body.selectedIgUserId))
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
    throw new InstagramTargetsApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new InstagramTargetsApiError(apiError.code, apiError.message);
  }
  return body;
}

/**
 * The accounts this user could publish to, read live from Meta each time. Publishes nothing and costs nothing.
 *
 * `selectedIgUserId` comes back only when a stored choice is actually still in this list — the server checks
 * rather than echoing, so the screen never shows a destination that no longer exists.
 */
export async function getInstagramTargets(): Promise<GetInstagramTargetsResponse> {
  const body = await request(API_ROUTES.instagramTargets);
  if (!isTargetsResponse(body)) throw new InstagramTargetsApiError(MALFORMED.code, MALFORMED.message);
  // Only present when the list is empty, and never load-bearing: a wrong shape costs the explanation, not the
  // screen.
  return isRecord(body) && isDiagnostics(body.diagnostics) ? { ...body, diagnostics: body.diagnostics } : { ...body, diagnostics: undefined };
}

/** Stores which account future posts go to. Rejected with INSTAGRAM_TARGET_NOT_FOUND if it is no longer listed. */
export async function setInstagramTarget(igUserId: string): Promise<SetInstagramTargetResponse> {
  const body = await request(API_ROUTES.instagramTarget, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ igUserId }),
  });
  if (!isTargetsResponse(body)) throw new InstagramTargetsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

/**
 * How to name an account on screen.
 *
 * The handle is what a person recognises their own account by, but it is not guaranteed to arrive: the backend
 * falls back to putting the numeric account id in `username` rather than dropping the account from the list —
 * being unable to pick your own account is worse than seeing it named badly. A bare number, though, is exactly
 * what must never appear as the account name in a publish confirmation, so this detects that case and names the
 * account by its connected Page instead, saying plainly that the handle could not be read.
 */
export function targetLabel(target: InstagramPublishTarget): { name: string; handleUnavailable: boolean } {
  const handleLooksNumeric = /^\d+$/u.test(target.username.trim());
  if (!handleLooksNumeric) return { name: `@${target.username.trim()}`, handleUnavailable: false };
  const page = target.pageName.trim();
  return { name: page || `계정 ${target.igUserId}`, handleUnavailable: true };
}
