import { DEFAULT_VIDEO_MODEL, NO_LEGIBLE_TEXT_VIDEO_RULE, providerTaskFailure, RUNWAY_PROMPT_MAX_LENGTH, RUNWAY_VIDEO_RATIOS, VIDEO_MODEL_OPTIONS, VIDEO_MODELS, type RunwayVideoRatio, type SceneFailureRemedy, type VideoModel } from "@ai-animation-studio/shared";
// Types only — erased at build, so no SDK code ever runs here (see `requestBodyFor` below for why that matters).
import type { ImageToVideoCreateParams } from "@runwayml/sdk/resources/image-to-video";
import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";
import { utf16Length } from "./video-preview.service.js";

/**
 * Real RunwayML API calls using a plain fetch request (no SDK at runtime), with each model's request body checked
 * at compile time against the official `@runwayml/sdk` types. Mirrors Python's `RunwayVideoAdapter`:
 * this module owns no workflow, budget, or polling-cadence decisions — a caller submits one task, checks its
 * status whenever it chooses to, and downloads the output once when it is ready.
 */

export const RUNWAY_BASE_URL = "https://api.dev.runwayml.com";
export const RUNWAY_VERSION = "2024-11-06";
/**
 * The model actually put on the wire — and, now, the one every record, preview and confirmation reports.
 *
 * Typed against the contract's VIDEO_MODELS so changing it is a compile error until the new name is listed
 * there. That is the point: the client guards check a response's model against that same list, so a swap made
 * here alone used to mean the server answering correctly and both video screens calling it malformed.
 */
export const RUNWAY_MODEL: VideoModel = DEFAULT_VIDEO_MODEL;

/** The name this app stores a chosen model under, in the same `.env` the monthly limits live in. */
export const VIDEO_MODEL_VARIABLE = "VIDEO_MODEL";

/** Reads a stored model exactly the way the monthly limit is read — see providers/monthly-budget-limit.ts. */
export interface VideoModelStore { readNamed(name: string): Promise<string | null>; }

/**
 * Which model this computer is set to use.
 *
 * Asked per question rather than at construction, so a model chosen on the settings screen applies to the next
 * quote instead of the next launch — the same posture the monthly limit took, and for the same reason.
 *
 * Anything the contract does not list falls back to the default. A stored name nobody can price would put a
 * fabricated rate under the budget check, and the safe direction is the model whose rate this machine's own
 * ledger has been confirming all along.
 */
export async function resolveVideoModel(store?: VideoModelStore, environment: NodeJS.ProcessEnv = process.env): Promise<VideoModel> {
  const stored = store ? await store.readNamed(VIDEO_MODEL_VARIABLE).catch(() => null) : null;
  const named = (stored ?? environment[VIDEO_MODEL_VARIABLE] ?? "").trim();
  return VIDEO_MODELS.includes(named as VideoModel) ? named as VideoModel : DEFAULT_VIDEO_MODEL;
}

/**
 * The model a stored generation record says it was made with.
 *
 * A job keeps the model it was confirmed under — the setting can change while it runs, and a retry resumes that
 * job, not a new one. Records written before a record carried its model (every Long Episode record until the
 * second model arrived) were all sent to the default model, so the default is what they truthfully were.
 */
export function recordedVideoModel(value: unknown): VideoModel {
  return VIDEO_MODELS.includes(value as VideoModel) ? value as VideoModel : DEFAULT_VIDEO_MODEL;
}

interface RequestParts { promptImage: string; promptText: string; ratio: RunwayVideoRatio; duration: number }

/**
 * What goes on the wire for each model. Exhaustive over `VideoModel`, so a model added to the contract does not
 * compile until its body is written here — and each body is `satisfies` Runway's own type for that model, so a
 * field the provider does not take (a `ratio` for h3_max, a last frame for gen4_turbo) is a build error rather
 * than a paid request that fails.
 *
 * 🔴 The SDK is used for its types only. At runtime it retries a POST up to twice on 408/409/429/5xx and sends
 * no idempotency key (its client leaves `idempotencyHeader` unset), so a paid task could be created three times
 * for one scene. This adapter never resends a submission (D-005); the SDK's types give the compile-time check
 * without its retries.
 *
 * 🔴 `promptExpansionMode: "disabled"` for H3 Max. Its default, `balanced`, rewrites the prompt before generating —
 * the prompt a person reviewed and confirmed would not be the one the model follows.
 */
const REQUEST_BODY: Record<VideoModel, (parts: RequestParts) => ImageToVideoCreateParams> = {
  gen4_turbo: ({ promptImage, promptText, ratio, duration }) =>
    ({ model: "gen4_turbo", promptImage, promptText, ratio, duration }) satisfies ImageToVideoCreateParams.Gen4Turbo,
  // Runway's own model, so a bare image string is its first frame (as for gen4_turbo), unlike WAN's.
  gen4_5: ({ promptImage, promptText, ratio, duration }) =>
    ({ model: "gen4.5", promptImage, promptText, ratio, duration }) satisfies ImageToVideoCreateParams.Gen4_5,
  h3_max_480p: ({ promptImage, promptText, duration }) =>
    ({ model: "h3_max", promptImage, promptText, duration, resolution: "480p", promptExpansionMode: "disabled" }) satisfies ImageToVideoCreateParams.H3Max,
  h3_max_768p: ({ promptImage, promptText, duration }) =>
    ({ model: "h3_max", promptImage, promptText, duration, resolution: "768p", promptExpansionMode: "disabled" }) satisfies ImageToVideoCreateParams.H3Max,
  wan3_480p: (parts) => wan3Body(parts, "auto_480p"),
  wan3_720p: (parts) => wan3Body(parts, "auto_720p"),
  wan3_1080p: (parts) => wan3Body(parts, "auto_1080p"),
  // The picture as an explicit first frame: HappyHorse takes the same shape as gen4_turbo, and naming the position
  // leaves nothing for a reader (or the provider) to infer.
  happyhorse_720p: ({ promptImage, promptText, duration }) =>
    ({ model: "happyhorse_1_0", promptImage: [{ position: "first", uri: promptImage }], promptText, duration, resolution: "720p" }) satisfies ImageToVideoCreateParams.Happyhorse1_0,
  happyhorse_1080p: ({ promptImage, promptText, duration }) =>
    ({ model: "happyhorse_1_0", promptImage: [{ position: "first", uri: promptImage }], promptText, duration, resolution: "1080p" }) satisfies ImageToVideoCreateParams.Happyhorse1_0,
  seedance2_720p: (parts) => ({ model: "seedance2", ...seedanceParts(parts, SEEDANCE_720P) }) satisfies ImageToVideoCreateParams.Seedance2,
  seedance2_1080p: (parts) => ({ model: "seedance2", ...seedanceParts(parts, { "720:1280": "1080:1920", "1280:720": "1920:1080" }) }) satisfies ImageToVideoCreateParams.Seedance2,
  seedance2_fast: (parts) => ({ model: "seedance2_fast", ...seedanceParts(parts, SEEDANCE_720P) }) satisfies ImageToVideoCreateParams.Seedance2Fast,
  seedance2_mini: (parts) => ({ model: "seedance2_mini", ...seedanceParts(parts, SEEDANCE_720P) }) satisfies ImageToVideoCreateParams.Seedance2Mini,
  seedance2_5_480p: (parts) => ({ model: "seedance2_5", ...seedanceParts(parts, { "720:1280": "480:854", "1280:720": "854:480" }) }) satisfies ImageToVideoCreateParams.Seedance2_5,
  seedance2_5_720p: (parts) => ({ model: "seedance2_5", ...seedanceParts(parts, SEEDANCE_720P) }) satisfies ImageToVideoCreateParams.Seedance2_5,
  seedance2_5_1080p: (parts) => ({ model: "seedance2_5", ...seedanceParts(parts, { "720:1280": "1080:1920", "1280:720": "1920:1080" }) }) satisfies ImageToVideoCreateParams.Seedance2_5,
  // "An image to use as the first frame ... Gemini Omni Flash only supports a first frame" — a bare string is it.
  gemini_omni_flash: ({ promptImage, promptText, ratio, duration }) =>
    ({ model: "gemini_omni_flash", promptImage, promptText, ratio, duration }) satisfies ImageToVideoCreateParams.GeminiOmniFlash,
  grok_imagine_480p: (parts) => grokBody(parts, "480p"),
  grok_imagine_720p: (parts) => grokBody(parts, "720p"),
  grok_imagine_1080p: (parts) => grokBody(parts, "1080p"),
};

/** The picture as an explicit first frame, as for HappyHorse: Grok takes the same shape, and naming it leaves nothing to infer. */
function grokBody({ promptImage, promptText, duration }: RequestParts, resolution: "480p" | "720p" | "1080p"): ImageToVideoCreateParams {
  return { model: "grok_imagine_1_5", promptImage: [{ position: "first", uri: promptImage }], promptText, duration, resolution } satisfies ImageToVideoCreateParams.GrokImagine1_5;
}

const SEEDANCE_720P = { "720:1280": "720:1280", "1280:720": "1280:720" } as const;

/**
 * Seedance's resolution is inside its ratio string, so each entry maps this app's two frames to its own strings.
 * Like WAN, a bare image string is a reference image there, so the picture goes as the first keyframe; and its
 * audio defaults to ON, which the merge would throw away, so it is switched off.
 */
function seedanceParts<const R extends string>({ promptImage, promptText, duration, ratio }: RequestParts, frames: Record<RunwayVideoRatio, R>) {
  return { promptImage: [{ position: "first" as const, uri: promptImage }], promptText, duration, ratio: frames[ratio], audio: false };
}

/**
 * The no-text line each model is sent after the prompt — request-time only, see NO_LEGIBLE_TEXT_VIDEO_RULE.
 *
 * Seedance gets it in its maker's own words. ByteDance's Seedance 2.0 prompt guide (BytePlus ModelArk, read
 * 2026-09-12) calls these "constraint words", "very important", and gives the templates "Avoid generating
 * subtitles", "Avoid generating a Logo", "Avoid generating a watermark", "Avoid generating any text or subtitles"
 * — and it notes the model readily renders text (ad slogans, subtitles, speech bubbles), so the line matters more
 * there. No longer than the shared rule: RUNWAY_PROMPT_AUTHORING_LIMIT reserves room for that length.
 */
export const SEEDANCE_TEXT_CONSTRAINT = "Avoid generating subtitles, logos, watermarks or any readable text.";
export function textRuleFor(model: VideoModel): string {
  return model.startsWith("seedance") ? SEEDANCE_TEXT_CONSTRAINT : NO_LEGIBLE_TEXT_VIDEO_RULE;
}

/**
 * 🔴 WAN reads a bare image string as a *reference* image, not as the first frame — its field is "an image or
 * array of images; use position first/last for keyframe mode, or omit position for reference images". So the
 * first frame goes as a keyframe, and keyframe requests must use an `auto_*` ratio (the shape follows the frame).
 * `audio: false`: the merge keeps only the picture (`-map 0:v:0`), so a soundtrack would be generated for nothing.
 */
function wan3Body({ promptImage, promptText, duration }: RequestParts, ratio: "auto_480p" | "auto_720p" | "auto_1080p"): ImageToVideoCreateParams {
  return { model: "wan3", promptImage: [{ position: "first", uri: promptImage }], promptText, duration, ratio, audio: false } satisfies ImageToVideoCreateParams.Wan3;
}

/**
 * The body for one scene, or a refusal before anything is sent. A clip longer than the model makes (Runway would
 * reject it) or a frame shape outside this app's vocabulary is an `invalid_request` here — no task is created, so
 * nothing is billed.
 */
export function requestBodyFor(model: VideoModel, parts: { promptImage: string; promptText: string; ratio: string; duration: number }): ImageToVideoCreateParams {
  const option = VIDEO_MODEL_OPTIONS.find((candidate) => candidate.id === model);
  if (!option) throw new RunwayAdapterError("invalid_request", `알 수 없는 영상 모델입니다: ${model}`);
  if (!Number.isInteger(parts.duration) || parts.duration < 1 || parts.duration > option.maxDurationSeconds) {
    throw new RunwayAdapterError("invalid_request", `${option.label}은(는) 한 장면을 최대 ${option.maxDurationSeconds}초까지만 만듭니다.`);
  }
  if (!(RUNWAY_VIDEO_RATIOS as readonly string[]).includes(parts.ratio)) throw new RunwayAdapterError("invalid_request", "영상 비율이 올바르지 않습니다.");
  return REQUEST_BODY[model]({ ...parts, ratio: parts.ratio as RunwayVideoRatio });
}
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
   * actually objected to.
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
  /**
   * The provider's failure code on its own, beside the sentence it used to be melted into.
   *
   * `failure` reads "An unexpected error occurred. (Runway code: INTERNAL.BAD_OUTPUT.CODE01)", and the client
   * looked that entire string up in a table of known codes, missed, and fell back to "잠시 후 다시 시도해
   * 주세요." That advice was wrong for this code and was charged for twice on 2026-09-05. A code can be
   * reasoned about; a sentence with a code inside it cannot.
   */
  failureCode: string;
  progress: number | null;
  terminal: boolean;
}

/**
 * What the provider's own documentation says to do about a code, and whether a failure is still charged.
 *
 * From docs.dev.runwayml.com/errors/task-failures. The distinction that matters is not the documented
 * `retryable` flag: BAD_OUTPUT is listed as retryable and fails forever until the input changes — the input is
 * the cause, and the documented first causes are "text or logos on the input media" and "the prompt asks for
 * text". Reporting that as "retry" is what let the same scene be bought twice for nothing.
 *
 * An unrecognised code is `retry` and billed: the honest default is that we do not know it is safe to press
 * again, but we do know the provider charges for failures.
 */
export function runwayFailureOutcome(failureCode: string): { remedy: SceneFailureRemedy; billedOnFailure: boolean } {
  const known = providerTaskFailure(failureCode);
  // Read from the contract's table rather than repeated here. The screen needs a sentence for the same codes,
  // and the two lists would have been keyed on the same strings — a remedy saying "change the input" beside a
  // sentence saying "try again shortly" is the drift this repository keeps finding, in its worst direction.
  return known ? { remedy: known.remedy, billedOnFailure: known.billedOnFailure } : { remedy: "retry", billedOnFailure: true };
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
  assertRealNetworkCallAllowed("Runway", fetchImpl);
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
  options: RetryOptions & { model?: VideoModel; ratio?: string; durationSeconds?: number } = {},
): Promise<{ taskId: string }> {
  // Appended here rather than at either caller: this is the one door to Runway, both pipelines come through it,
  // and a third caller cannot forget it. The prompt a person confirmed is what gets recorded; this line is only
  // ever sent — see NO_LEGIBLE_TEXT_VIDEO_RULE for the four live scenes that ask Runway for lettering, and for
  // why recording it instead would mark all 43 recorded prompts stale.
  const authored = prompt.trim();
  if (!authored) throw new RunwayAdapterError("invalid_request", "Runway 프롬프트가 비어 있습니다.");
  const model = options.model ?? RUNWAY_MODEL;
  const text = `${authored}
${textRuleFor(model)}`;
  if (utf16Length(text) > RUNWAY_PROMPT_MAX_LENGTH) throw new RunwayAdapterError("invalid_request", `Runway 프롬프트가 ${RUNWAY_PROMPT_MAX_LENGTH} UTF-16 코드 유닛을 초과했습니다.`);
  const requestBody = requestBodyFor(model, {
    promptImage: imageDataUri(imageBytes, imageMimeType), promptText: text, ratio: options.ratio ?? "720:1280", duration: options.durationSeconds ?? 5,
  });
  const response = await requestWithRetry(`${RUNWAY_BASE_URL}/v1/image_to_video`, {
    method: "POST",
    headers: {
      "content-type": "application/json", authorization: `Bearer ${apiSecret}`,
      "x-runway-version": RUNWAY_VERSION,
    },
    body: JSON.stringify(requestBody),
    // Unlike a status check or a download, this call creates a paid, non-idempotent resource. A `fetch` throw
    // (timeout, connection reset) is ambiguous — it does not tell us whether Runway ever received the request,
    // only that we did not see its response — so retrying it can create a second real task for one scene, which
    // Runway bills independently and which our own records then have no way to notice
    // (docs/06_DECISIONS.md D-005). `maxRetries: 0` overrides whatever the caller passed for every other call this adapter makes.
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
  return { taskId, status, outputUrls, failure, failureCode, progress, terminal: TERMINAL_STATUSES.has(status) };
}

/** Download an ephemeral Runway output URL. This is a signed URL — it needs no Runway auth header. */
export async function downloadRunwayOutput(url: string, options: RetryOptions = {}): Promise<Buffer> {
  if (!url.startsWith("https://") && !url.startsWith("http://")) throw new RunwayAdapterError("invalid_request", "Runway 출력 URL이 올바르지 않습니다.");
  const response = await requestWithRetry(url, { method: "GET" }, options);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new RunwayAdapterError("unknown", "Runway 출력 다운로드 결과가 비어 있습니다.");
  return bytes;
}
