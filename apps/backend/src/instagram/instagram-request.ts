import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";

/**
 * Shared request/error machinery for every Meta Graph API call this app makes (content publishing and OAuth
 * alike). Extracted rather than copied into each adapter specifically so the error classification cannot drift
 * between them — two copies of a table like this reliably stop matching, which is the failure shape this
 * codebase has hit repeatedly (see ProjectSummary.aspectRatio's doc comment for the same lesson).
 */

export const GRAPH_BASE_URL = "https://graph.facebook.com";
export const GRAPH_UPLOAD_BASE_URL = "https://rupload.facebook.com";
export const GRAPH_API_VERSION = "v26.0";

export type InstagramErrorCategory = "authentication" | "permission" | "rate_limit" | "invalid_request" | "server" | "network" | "unknown";

const INSTAGRAM_KOREAN_MESSAGES: Record<InstagramErrorCategory, string> = {
  authentication: "Instagram 액세스 토큰 인증에 실패했습니다.",
  permission: "이 Instagram 계정에 대한 권한이 없습니다. 연결된 페이스북 페이지를 확인하세요.",
  rate_limit: "Instagram API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
  invalid_request: "Instagram 요청이 거부되었습니다.",
  server: "Instagram(Meta) 서버의 일시적인 오류가 발생했습니다.",
  network: "Instagram 연결 시간이 초과되거나 네트워크 연결에 실패했습니다.",
  unknown: "Instagram 요청을 완료하지 못했습니다.",
};

const RETRYABLE = new Set<InstagramErrorCategory>(["rate_limit", "server", "network"]);
const DEFAULT_MAX_RETRIES = 2;
const MAX_BACKOFF_SECONDS = 4;

/**
 * The numbers Meta answered with, kept apart from `detail` because they are safe to write down anywhere.
 *
 * These are exactly what the classification below reads, which is what makes them worth carrying: when a
 * category looks wrong, the only way to tell a misreading from a real outage is to see the values it was
 * derived from. `detail` cannot serve that purpose — it is Meta's own prose and never leaves diagnosis.
 */
export interface InstagramErrorDiagnostics {
  /** HTTP status of Meta's response. */
  status?: number;
  /** Graph API's own `error.code` / `error_subcode`, when the body carried them. */
  graphCode?: number;
  graphSubcode?: number;
}

export class InstagramAdapterError extends Error {
  /** `message` is always the fixed, safe Korean text for `category` — Meta's own wording is never shown to the user, matching every other provider-error class in this codebase. `detail` is Meta's own error text, kept only for diagnosis (never rendered). */
  constructor(
    public readonly category: InstagramErrorCategory,
    message: string = INSTAGRAM_KOREAN_MESSAGES[category],
    public readonly detail?: string,
    public readonly diagnostics: InstagramErrorDiagnostics = {},
  ) {
    super(message);
  }
}

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export interface RetryOptions { maxRetries?: number; fetchImpl?: typeof fetch; sleep?: (seconds: number) => Promise<void> }

function defaultSleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Graph API's own error.code is the more specific signal — verified against Meta's documented codes (190 =
 * expired/invalid token, 4/17/613 = throttling, 10 and 200-299 = permission). Falls back to the HTTP status when
 * the body carries no parseable error object at all.
 *
 * 🔴 1 and 2 are split, and the difference is the whole point. Meta documents code 2 as one situation — "가동
 * 중단으로 인한 일시적인 문제입니다" — so "server", whose message tells the person to wait, is a true statement
 * about it. Code 1 is documented as two: the same downtime, *and* "문제가 다시 발생하면 기존 API를 요청하고
 * 있는지 확인하세요". A code that means either of two things cannot be reported as one of them.
 *
 * That is not a style point. Mapping 1 onto "server" produced a login failure described as a temporary Meta
 * outage, and the reasonable response to that description — wait, retry unchanged — is the one thing that could
 * not work, while the real fix sat in the person's own settings. "unknown" claims nothing and instructs nothing,
 * which is the honest content of a catch-all (docs/06_DECISIONS.md D-006). It also leaves RETRYABLE, correctly:
 * retrying is a guess when the cause might be a request that will never succeed.
 */
function classifyGraphErrorCode(code: number): InstagramErrorCategory {
  if (code === 190) return "authentication";
  if (code === 10 || (code >= 200 && code <= 299)) return "permission";
  if (code === 4 || code === 17 || code === 613) return "rate_limit";
  if (code === 2) return "server";
  if (code === 1) return "unknown";
  return "invalid_request";
}

function classifyStatus(status: number): InstagramErrorCategory {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "invalid_request";
}

/** Graph API's standard error envelope: `{ error: { message, type, code, error_subcode, fbtrace_id } }`. Never throws — an unreadable or unexpected body just falls back to status-based classification with no detail. */
async function classifyErrorResponse(response: Response): Promise<{ category: InstagramErrorCategory; detail?: string; diagnostics: InstagramErrorDiagnostics }> {
  // Carried even when the body cannot be read, because "which branch classified this" is the question these
  // answer, and the unreadable-body branch is one of the answers.
  const diagnostics: InstagramErrorDiagnostics = { status: response.status };
  let body: unknown;
  try { body = await response.json(); } catch { return { category: classifyStatus(response.status), diagnostics }; }
  const error = isObject(body) && isObject(body.error) ? body.error : undefined;
  const code = typeof error?.code === "number" ? error.code : undefined;
  if (code !== undefined) diagnostics.graphCode = code;
  if (typeof error?.error_subcode === "number") diagnostics.graphSubcode = error.error_subcode;
  const category = code !== undefined ? classifyGraphErrorCode(code) : classifyStatus(response.status);
  const message = typeof error?.message === "string" ? error.message.trim() : undefined;
  return { category, ...(message ? { detail: message.slice(0, 500) } : {}), diagnostics };
}

export async function requestWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;
  assertRealNetworkCallAllowed("Instagram", fetchImpl);
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch {
      if (attempt >= maxRetries) throw new InstagramAdapterError("network");
      await sleep(Math.min(MAX_BACKOFF_SECONDS, 0.5 * 2 ** attempt));
      attempt += 1; continue;
    }
    if (response.ok) return response;
    const { category, detail, diagnostics } = await classifyErrorResponse(response);
    if (!RETRYABLE.has(category) || attempt >= maxRetries) throw new InstagramAdapterError(category, undefined, detail, diagnostics);
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Math.max(0, Math.min(MAX_BACKOFF_SECONDS, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0.5 * 2 ** attempt)));
    attempt += 1;
  }
}
