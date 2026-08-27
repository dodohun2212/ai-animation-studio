import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";

/**
 * Real Instagram Content Publishing API calls using a plain fetch request (no SDK dependency). Protocol verified
 * against Meta's official documentation directly, not third-party summaries (`.claude-bridge` Round 183):
 * developers.facebook.com/docs/instagram-platform/content-publishing/ and
 * .../content-publishing/resumable-uploads/. Mirrors runway-video-adapter.ts's shape: this module owns no
 * workflow or approval decisions — a caller creates one container, uploads bytes to it, checks its status
 * whenever it chooses to, and publishes it once, exactly once, when it decides to.
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

export class InstagramAdapterError extends Error {
  /** `message` is always the fixed, safe Korean text for `category` — Meta's own wording is never shown to the user, matching every other provider-error class in this codebase. `detail` is Meta's own error text, kept only for diagnosis (never rendered). */
  constructor(public readonly category: InstagramErrorCategory, message: string = INSTAGRAM_KOREAN_MESSAGES[category], public readonly detail?: string) {
    super(message);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

interface RetryOptions { maxRetries?: number; fetchImpl?: typeof fetch; sleep?: (seconds: number) => Promise<void> }

function defaultSleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Graph API's own error.code is the more specific signal — verified against Meta's documented codes (190 =
 * expired/invalid token, 4/17/613 = throttling, 1/2 = transient server, 10 and 200-299 = permission). Falls back
 * to the HTTP status when the body carries no parseable error object at all.
 */
function classifyGraphErrorCode(code: number): InstagramErrorCategory {
  if (code === 190) return "authentication";
  if (code === 10 || (code >= 200 && code <= 299)) return "permission";
  if (code === 4 || code === 17 || code === 613) return "rate_limit";
  if (code === 1 || code === 2) return "server";
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
async function classifyErrorResponse(response: Response): Promise<{ category: InstagramErrorCategory; detail?: string }> {
  let body: unknown;
  try { body = await response.json(); } catch { return { category: classifyStatus(response.status) }; }
  const error = isObject(body) && isObject(body.error) ? body.error : undefined;
  const code = typeof error?.code === "number" ? error.code : undefined;
  const category = code !== undefined ? classifyGraphErrorCode(code) : classifyStatus(response.status);
  const message = typeof error?.message === "string" ? error.message.trim() : undefined;
  return { category, ...(message ? { detail: message.slice(0, 500) } : {}) };
}

async function requestWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
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
    const { category, detail } = await classifyErrorResponse(response);
    if (!RETRYABLE.has(category) || attempt >= maxRetries) throw new InstagramAdapterError(category, undefined, detail);
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Math.max(0, Math.min(MAX_BACKOFF_SECONDS, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0.5 * 2 ** attempt)));
    attempt += 1;
  }
}

/**
 * Reserves a REELS container this account will publish into, and returns the rupload URI to send the video
 * bytes to next. `maxRetries: 0` regardless of what the caller passes: an ambiguous network failure here (a
 * `fetch` throw, not a clean error response) does not tell us whether Meta ever created the container, so
 * retrying could reserve a second, orphaned one — reserving is cheap to leave dangling, unlike this adapter's
 * publishContainer(), but the same "don't guess after an ambiguous failure" discipline applies uniformly.
 */
export async function createInstagramResumableContainer(accessToken: string, igUserId: string, options: RetryOptions = {}): Promise<{ containerId: string }> {
  if (!igUserId.trim()) throw new InstagramAdapterError("invalid_request", "Instagram 계정 ID가 필요합니다.");
  const response = await requestWithRetry(
    `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(igUserId)}/media`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ media_type: "REELS", upload_type: "resumable" }),
    },
    { ...options, maxRetries: 0 },
  );
  const body: unknown = await response.json().catch(() => null);
  const containerId = isObject(body) && typeof body.id === "string" ? body.id.trim() : "";
  if (!containerId) throw new InstagramAdapterError("unknown", undefined, "Instagram 응답에 컨테이너 ID가 없습니다.");
  return { containerId };
}

/**
 * Uploads the whole video in one call (not chunked) — the documented protocol supports resuming a partial
 * upload via `offset`/`bytes_transferred`, but this app's Reels are always short and local, so a single-shot
 * upload is the simpler, sufficient choice for now; a failed upload can just start over with a fresh container
 * rather than needing resume logic. `maxRetries: 0`: retrying an ambiguous failure could upload the same bytes
 * twice against a container that already has them, and the protocol gives no cheap way to check that first.
 */
export async function uploadInstagramResumableVideo(accessToken: string, containerId: string, videoBytes: Buffer, options: RetryOptions = {}): Promise<void> {
  if (videoBytes.length === 0) throw new InstagramAdapterError("invalid_request", "업로드할 영상이 비어 있습니다.");
  const response = await requestWithRetry(
    `${GRAPH_UPLOAD_BASE_URL}/ig-api-upload/${GRAPH_API_VERSION}/${encodeURIComponent(containerId)}`,
    {
      method: "POST",
      headers: { authorization: `OAuth ${accessToken}`, offset: "0", file_size: String(videoBytes.length) },
      // Node's fetch accepts a Buffer body at runtime; the DOM BodyInit type just doesn't know about it.
      body: videoBytes as unknown as BodyInit,
    },
    { ...options, maxRetries: 0 },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!isObject(body) || body.success !== true) throw new InstagramAdapterError("unknown", undefined, "Instagram 업로드 응답이 성공을 나타내지 않습니다.");
}

export type InstagramContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";
const KNOWN_STATUSES = new Set<InstagramContainerStatus>(["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"]);

/** Retrieve one container's current processing state once; polling cadence is entirely the caller's responsibility — same division of concerns as runway-video-adapter.ts's getRunwayTask(). */
export async function getInstagramContainerStatus(accessToken: string, containerId: string, options: RetryOptions = {}): Promise<{ statusCode: InstagramContainerStatus }> {
  const response = await requestWithRetry(
    `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(containerId)}?fields=status_code`,
    { method: "GET", headers: { authorization: `Bearer ${accessToken}` } },
    options,
  );
  const body: unknown = await response.json().catch(() => null);
  const raw = isObject(body) && typeof body.status_code === "string" ? body.status_code : "";
  if (!KNOWN_STATUSES.has(raw as InstagramContainerStatus)) throw new InstagramAdapterError("unknown", undefined, `Instagram 컨테이너 응답에 알 수 없는 status_code: ${raw || "(없음)"}`);
  return { statusCode: raw as InstagramContainerStatus };
}

/**
 * Publishes the container to the account's real, public feed — irreversible. `maxRetries: 0` unconditionally,
 * the same non-negotiable rule runway-video-adapter.ts's createRunwayImageToVideoTask() applies to paid task
 * creation: an ambiguous `fetch` failure here does not tell us whether Meta ever received the request, so
 * retrying could publish the same container twice. The caller (not this module) owns requiring the user's
 * explicit, one-time confirmation before this is ever called at all.
 */
export async function publishInstagramContainer(accessToken: string, igUserId: string, containerId: string, options: RetryOptions = {}): Promise<{ mediaId: string }> {
  const response = await requestWithRetry(
    `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(igUserId)}/media_publish`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ creation_id: containerId }),
    },
    { ...options, maxRetries: 0 },
  );
  const body: unknown = await response.json().catch(() => null);
  const mediaId = isObject(body) && typeof body.id === "string" ? body.id.trim() : "";
  if (!mediaId) throw new InstagramAdapterError("unknown", undefined, "Instagram 게시 응답에 media ID가 없습니다.");
  return { mediaId };
}
