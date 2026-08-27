import {
  GRAPH_API_VERSION, GRAPH_BASE_URL, GRAPH_UPLOAD_BASE_URL,
  InstagramAdapterError, isObject, requestWithRetry, type RetryOptions,
} from "./instagram-request.js";

/**
 * Real Instagram Content Publishing API calls using a plain fetch request (no SDK dependency). Protocol verified
 * against Meta's official documentation directly, not third-party summaries (`.claude-bridge` Round 183):
 * developers.facebook.com/docs/instagram-platform/content-publishing/ and
 * .../content-publishing/resumable-uploads/. Mirrors runway-video-adapter.ts's shape: this module owns no
 * workflow or approval decisions — a caller creates one container, uploads bytes to it, checks its status
 * whenever it chooses to, and publishes it once, exactly once, when it decides to.
 *
 * Request/error machinery lives in instagram-request.ts, shared with instagram-oauth.ts.
 */

export { GRAPH_API_VERSION, GRAPH_BASE_URL, GRAPH_UPLOAD_BASE_URL, InstagramAdapterError };
export type { InstagramErrorCategory } from "./instagram-request.js";

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
