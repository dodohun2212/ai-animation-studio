import { RUNWAY_PROMPT_MAX_LENGTH } from "@ai-animation-studio/shared";
import { utf16Length } from "./video-preview.service.js";

/**
 * Real RunwayML API calls using a plain fetch request (no SDK dependency), verified against the official
 * `runwayml` Node SDK's request/response shapes and endpoint constants. Mirrors Python's `RunwayVideoAdapter`:
 * this module owns no workflow, budget, or polling-cadence decisions — a caller submits one task, checks its
 * status whenever it chooses to, and downloads the output once when it is ready.
 */

export const RUNWAY_BASE_URL = "https://api.dev.runwayml.com";
export const RUNWAY_VERSION = "2024-11-06";
export const RUNWAY_MODEL = "gen4_turbo";
const MAX_DATA_URI_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 2;
const MAX_BACKOFF_SECONDS = 4;

export type RunwayErrorCategory = "authentication" | "permission" | "quota_or_permission" | "rate_limit" | "invalid_request" | "server" | "network" | "unknown";

const RUNWAY_KOREAN_MESSAGES: Record<RunwayErrorCategory, string> = {
  authentication: "Runway API 키 인증에 실패했습니다.",
  permission: "Runway 프로젝트 권한을 확인하세요.",
  quota_or_permission: "Runway 크레딧이 부족합니다. Runway 계정에서 크레딧을 충전한 뒤 다시 시도하세요.",
  rate_limit: "Runway 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
  invalid_request: "Runway 요청이 거부되었습니다. 모델, 비율 또는 프롬프트를 확인하세요.",
  server: "Runway 서버의 일시적인 오류가 반복되었습니다.",
  network: "Runway 연결 시간이 초과되거나 네트워크 연결에 실패했습니다.",
  unknown: "Runway 요청을 완료하지 못했습니다.",
};

const RETRYABLE = new Set<RunwayErrorCategory>(["rate_limit", "server", "network"]);

export class RunwayAdapterError extends Error {
  /**
   * `message` is always the fixed, safe Korean text for `category` — never Runway's own words, the same rule
   * every other provider-error class in this codebase follows. `detail`, when present, is Runway's own error
   * text pulled from a rejected response body: never shown to the user, but worth persisting into
   * `video_generation_records[].error` so a real rejection can be diagnosed without reproducing the paid call —
   * a $0.25 scene-1 failure with only the category "invalid_request" recorded left no way to tell what Runway
   * actually objected to (`.claude-bridge` Round 143).
   */
  constructor(public readonly category: RunwayErrorCategory, message: string = RUNWAY_KOREAN_MESSAGES[category], public readonly detail?: string) {
    super(message);
  }
}

export type RunwayTaskStatus = "PENDING" | "THROTTLED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export interface RunwayTask {
  taskId: string;
  status: RunwayTaskStatus;
  outputUrls: string[];
  failure: string;
  progress: number | null;
  terminal: boolean;
}

const TERMINAL_STATUSES = new Set<RunwayTaskStatus>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

interface RetryOptions { maxRetries?: number; fetchImpl?: typeof fetch; sleep?: (seconds: number) => Promise<void> }

function defaultSleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function classifyStatus(status: number): RunwayErrorCategory {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 404 || status === 409 || status === 422) return "invalid_request";
  if (status >= 500) return "server";
  return "unknown";
}

/** Best-effort: Runway's own rejection reason from a non-ok response body, for the persisted record only (see RunwayAdapterError's `detail`). Never throws — an unreadable or unexpected body just means no detail is available. */
async function errorDetailFrom(response: Response): Promise<string | undefined> {
  let body: unknown;
  try { body = await response.json(); } catch { return undefined; }
  if (!isObject(body)) return undefined;
  const message = typeof body.error === "string" ? body.error
    : isObject(body.error) && typeof body.error.message === "string" ? body.error.message
    : typeof body.message === "string" ? body.message
    : undefined;
  const trimmed = message?.trim();
  return trimmed ? trimmed.slice(0, 500) : undefined;
}

/**
 * A credit-shortage rejection has no dedicated Runway status code — the real incident this reclassifies (Round
 * 143/144) was a plain 400 whose body read "You do not have enough credits to run this task.", indistinguishable
 * by status alone from any other invalid_request. Refines the status-based category using the same body already
 * read for `detail`, once, only on the throw path (never on a retryable response, which never reaches here).
 */
function refineCategory(statusCategory: RunwayErrorCategory, detail: string | undefined): RunwayErrorCategory {
  const lower = detail?.toLowerCase() ?? "";
  if ((statusCategory === "invalid_request" || statusCategory === "permission") && (lower.includes("credit") || lower.includes("insufficient_quota") || lower.includes("quota"))) {
    return "quota_or_permission";
  }
  return statusCategory;
}

async function requestWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch {
      if (attempt >= maxRetries) throw new RunwayAdapterError("network");
      await sleep(Math.min(MAX_BACKOFF_SECONDS, 0.5 * 2 ** attempt));
      attempt += 1; continue;
    }
    if (response.ok) return response;
    const category = classifyStatus(response.status);
    if (!RETRYABLE.has(category) || attempt >= maxRetries) {
      const detail = await errorDetailFrom(response);
      throw new RunwayAdapterError(refineCategory(category, detail), undefined, detail);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Math.max(0, Math.min(MAX_BACKOFF_SECONDS, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0.5 * 2 ** attempt)));
    attempt += 1;
  }
}

function imageDataUri(bytes: Buffer, mimeType: string): string {
  if (bytes.length === 0) throw new RunwayAdapterError("invalid_request", "Reference 이미지가 비어 있습니다.");
  if (!mimeType.startsWith("image/")) throw new RunwayAdapterError("invalid_request", "Reference 파일은 이미지여야 합니다.");
  // Runway's 5MB limit applies to the base64 text actually sent, not the source bytes — base64 inflates size by
  // ~4/3, so a 3.5MB PNG (well under the old raw-byte check) becomes a 4.7MB string here and was rejected only
  // remotely, after the request had already gone out.
  const base64 = bytes.toString("base64");
  if (base64.length > MAX_DATA_URI_BYTES) throw new RunwayAdapterError("invalid_request", "Reference 이미지가 Runway의 5MB data-URI 제한을 초과했습니다.");
  return `data:${mimeType};base64,${base64}`;
}

/** Create one paid image-to-video task and immediately return its persistent ID; never polls itself. */
export async function createRunwayImageToVideoTask(
  apiSecret: string,
  imageBytes: Buffer,
  imageMimeType: string,
  prompt: string,
  options: RetryOptions & { model?: string; ratio?: string; durationSeconds?: number } = {},
): Promise<{ taskId: string }> {
  const text = prompt.trim();
  if (!text) throw new RunwayAdapterError("invalid_request", "Runway 프롬프트가 비어 있습니다.");
  if (utf16Length(text) > RUNWAY_PROMPT_MAX_LENGTH) throw new RunwayAdapterError("invalid_request", `Runway 프롬프트가 ${RUNWAY_PROMPT_MAX_LENGTH} UTF-16 코드 유닛을 초과했습니다.`);
  const response = await requestWithRetry(`${RUNWAY_BASE_URL}/v1/image_to_video`, {
    method: "POST",
    headers: {
      "content-type": "application/json", authorization: `Bearer ${apiSecret}`,
      "x-runway-version": RUNWAY_VERSION,
    },
    body: JSON.stringify({
      model: options.model ?? RUNWAY_MODEL,
      promptImage: imageDataUri(imageBytes, imageMimeType),
      promptText: text,
      ratio: options.ratio ?? "720:1280",
      duration: options.durationSeconds ?? 5,
    }),
    // Unlike a status check or a download, this call creates a paid, non-idempotent resource. A `fetch` throw
    // (timeout, connection reset) is ambiguous — it does not tell us whether Runway ever received the request,
    // only that we did not see its response — so retrying it can create a second real task for one scene, which
    // Runway bills independently and which our own records then have no way to notice (`.claude-bridge`
    // Round 145: a real user's Runway dashboard showed exactly this — two POSTs per scene, one task ever polled,
    // both billed). `maxRetries: 0` overrides whatever the caller passed for every other call this adapter makes.
  }, { ...options, maxRetries: 0 });
  const body: unknown = await response.json().catch(() => null);
  const taskId = isObject(body) && typeof body.id === "string" ? body.id.trim() : "";
  if (!taskId) throw new RunwayAdapterError("unknown", "Runway 응답에 task ID가 없습니다.");
  return { taskId };
}

/** Retrieve one task's current state once; polling cadence is entirely the caller's responsibility. */
export async function getRunwayTask(apiSecret: string, taskId: string, options: RetryOptions = {}): Promise<RunwayTask> {
  if (!taskId.trim()) throw new RunwayAdapterError("invalid_request", "task_id가 필요합니다.");
  const response = await requestWithRetry(`${RUNWAY_BASE_URL}/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiSecret}`, "x-runway-version": RUNWAY_VERSION },
  }, options);
  const body: unknown = await response.json().catch(() => null);
  if (!isObject(body) || typeof body.status !== "string" || !body.status) throw new RunwayAdapterError("unknown", "Runway task 응답에 상태가 없습니다.");
  const status = body.status.toUpperCase() as RunwayTaskStatus;
  const rawOutput = body.output;
  const outputUrls = Array.isArray(rawOutput) ? rawOutput.map(String).filter((item) => item.trim())
    : typeof rawOutput === "string" && rawOutput.trim() ? [rawOutput] : [];
  const failureMessage = typeof body.failure === "string" ? body.failure.trim() : "";
  const failureCode = typeof body.failureCode === "string" ? body.failureCode.trim() : "";
  const failure = failureCode && !failureMessage.toLowerCase().includes(failureCode.toLowerCase())
    ? (failureMessage ? `${failureMessage} (Runway code: ${failureCode})` : `Runway code: ${failureCode}`)
    : failureMessage;
  const progress = typeof body.progress === "number" ? body.progress : null;
  return { taskId, status, outputUrls, failure, progress, terminal: TERMINAL_STATUSES.has(status) };
}

/** Download an ephemeral Runway output URL. This is a signed URL — it needs no Runway auth header. */
export async function downloadRunwayOutput(url: string, options: RetryOptions = {}): Promise<Buffer> {
  if (!url.startsWith("https://") && !url.startsWith("http://")) throw new RunwayAdapterError("invalid_request", "Runway 출력 URL이 올바르지 않습니다.");
  const response = await requestWithRetry(url, { method: "GET" }, options);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new RunwayAdapterError("unknown", "Runway 출력 다운로드 결과가 비어 있습니다.");
  return bytes;
}
