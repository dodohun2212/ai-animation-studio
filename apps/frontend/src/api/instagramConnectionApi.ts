import {
  API_ROUTES,
  type CompleteInstagramLoginResponse,
  type InstagramConnectionStatus,
  type SetInstagramAppResponse,
  type StartInstagramLoginRequest,
  type StartInstagramLoginResponse,
} from "@ai-animation-studio/shared";
import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

export class InstagramConnectionApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InstagramConnectionApiError";
    this.code = code;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력한 값을 확인해 주세요.",
  INSTAGRAM_NOT_CONNECTED: "인스타그램에 로그인되어 있지 않습니다.",
  INSTAGRAM_PROVIDER_ERROR: "인스타그램에서 요청을 거부했습니다. 앱 ID와 시크릿이 맞는지 확인한 뒤 다시 시도해 주세요.",
  INSTAGRAM_STORAGE_ERROR: "인스타그램 연결 정보를 저장하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/**
 * One code, one sentence — and one table deciding it.
 *
 * Exported because a refusal now reaches the screen two ways: thrown by the request that made it, and reported
 * by `lastLoginError` on a status the screen polled. Both end here, so the desktop and browser flows cannot
 * come to describe the same failure differently. A second table keyed on something else is how they would.
 */
export function instagramConnectionErrorForCode(code: string): { code: string; message: string } {
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, code)) return { code, message: SAFE_ERRORS[code]! };
  if (code === NETWORK.code) return NETWORK;
  if (code === MALFORMED.code) return MALFORMED;
  if (code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

/** Never surfaces the backend's raw message — and the backend never puts a token or secret in one anyway. */
export function toInstagramConnectionDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof InstagramConnectionApiError)) return UNKNOWN;
  return instagramConnectionErrorForCode(error.code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStatus(value: unknown): value is InstagramConnectionStatus {
  return (
    isRecord(value)
    && typeof value.appConfigured === "boolean"
    && typeof value.tokenStored === "boolean"
    // Required, deliberately: this decides whether the browser is offered a sign-in at all, and defaulting a
    // missing value would pick one of the two wrong answers silently — either hiding a working path or
    // offering one that cannot complete.
    && typeof value.callbackLoginAvailable === "boolean"
    && (value.tokenExpiresAt === undefined || isNonEmptyString(value.tokenExpiresAt))
    // Optional by contract, so absence is valid and only the shape is checked — unlike callbackLoginAvailable,
    // where a missing value would have to be guessed at. Here "missing" already means something exact: no
    // attempt has anything to report.
    && (value.lastLoginError === undefined
      || (isRecord(value.lastLoginError) && isNonEmptyString(value.lastLoginError.code)))
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
    throw new InstagramConnectionApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    // A 5xx that did not even carry the backend's own error shape means the backend never answered — it is
    // down, restarting, or something in front of it replied. Say that, instead of blaming the response body.
    if (isServerUnavailable(response.status, apiError.code)) {
      throw new InstagramConnectionApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    throw new InstagramConnectionApiError(apiError.code, apiError.message);
  }
  return body;
}

async function requestStatus(url: string, init?: RequestInit): Promise<InstagramConnectionStatus> {
  const body = await request(url, init);
  if (!isStatus(body)) throw new InstagramConnectionApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

/** What the app holds for Instagram. Never includes the token or the secret — only whether they exist. */
export async function getInstagramConnection(): Promise<InstagramConnectionStatus> {
  return requestStatus(API_ROUTES.instagramConnection);
}

/**
 * Stores the Meta app id and secret.
 *
 * Saving these clears any stored token, deliberately: a token issued by one app means nothing to another, and
 * keeping it would leave the app looking signed in while every publish fails (D-006). Callers must say so before
 * calling this, not after.
 */
export async function setInstagramApp(appId: string, appSecret: string): Promise<SetInstagramAppResponse> {
  return requestStatus(API_ROUTES.instagramApp, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    // Trimmed here so what the person sees confirmed is what was sent; the server trims too, but a
    // pasted value carrying whitespace should not depend on that to look right.
    body: JSON.stringify({ appId: appId.trim(), appSecret: appSecret.trim() }),
  });
}

/**
 * The Meta login page to open, and — for the desktop flow — the address whose arrival means the login is done.
 *
 * The caller names its own flow because only the caller knows it: the server sees the same request from a
 * browser tab and from the shell, and cannot tell which one can read its own window. A wrong guess here does
 * not fail loudly — it opens a window nobody watches and waits — so it is asked for rather than inferred.
 *
 * `redirectPrefix` is optional in the contract and its absence is meaningful rather than a defect: it marks a
 * flow that needs no window watched, which today only the dormant callback route produces. So this validates
 * the field's *shape* and hands its presence to the caller to act on — rejecting a response for lacking it
 * would reject a response the contract calls valid.
 */
export async function startInstagramLogin(flow: StartInstagramLoginRequest["flow"]): Promise<StartInstagramLoginResponse> {
  const body = await request(API_ROUTES.instagramLoginStart, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flow }),
  });
  if (!isRecord(body) || !isNonEmptyString(body.url)) {
    throw new InstagramConnectionApiError(MALFORMED.code, MALFORMED.message);
  }
  if (body.redirectPrefix !== undefined && !isNonEmptyString(body.redirectPrefix)) {
    throw new InstagramConnectionApiError(MALFORMED.code, MALFORMED.message);
  }
  return isNonEmptyString(body.redirectPrefix)
    ? { url: body.url, redirectPrefix: body.redirectPrefix }
    : { url: body.url };
}

/**
 * Hands the landed URL back whole. The server reads the code out of it and checks it against the `state` it
 * issued — the screen parses nothing, so a URL that did not come from our own request cannot be laundered into
 * a login here. It is also why the screen can pass along an address it does not understand.
 */
export async function completeInstagramLogin(redirectedUrl: string): Promise<CompleteInstagramLoginResponse> {
  return requestStatus(API_ROUTES.instagramLoginComplete, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirectedUrl }),
  });
}

/** Signs out: drops the stored token. The app id and secret stay, so signing back in needs no re-entry. */
export async function disconnectInstagram(): Promise<InstagramConnectionStatus> {
  return requestStatus(API_ROUTES.instagramConnection, { method: "DELETE" });
}
