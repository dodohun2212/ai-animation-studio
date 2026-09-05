import { API_ROUTES, FINAL_VIDEO_RELATIVE_PATH, type MergeAudioSettings, type MergeVideosResponse, type PhotoCardSubtitleLayout } from "@ai-animation-studio/shared";

export class VideoMergeApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "VideoMergeApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  VIDEO_MERGE_NOT_ALLOWED: "모든 장면 영상이 승인된 뒤에만 최종 병합을 진행할 수 있습니다.",
  // Not a failure to fix — the work is already done. The gate that produces this used to answer with the
  // "approve every scene first" sentence, which sent people to re-approve scenes that were already approved.
  // Whether a re-merge should be allowed at all is a separate, product question; until it is, saying the true
  // reason is the least this can do.
  VIDEO_MERGE_ALREADY_COMPLETED: "이미 최종 영상이 만들어진 프로젝트입니다. 다시 만들려면 먼저 지금 영상을 정리해 주세요.",
  /* Not a refusal to fix — nothing is wrong and nothing changed. Something else is holding this exact file
     right now (a publish reading its bytes, or another render writing them), and the only correct move is to
     wait a moment. Saying "다시 시도" without saying that reads as "it failed", which sends people looking for
     a cause that does not exist. */
  VIDEO_MERGE_BUSY: "지금 이 영상을 다른 곳에서 쓰는 중입니다 — 게시 중이거나 새로 만드는 중입니다. 잠시 뒤에 다시 눌러 주세요.",
  VIDEO_MERGE_CLIPS_INVALID: "승인된 장면 영상 파일을 확인할 수 없습니다. 영상 검토 화면에서 장면을 다시 확인해 주세요.",
  FFMPEG_UNAVAILABLE: "이 컴퓨터에서 로컬 영상 병합 프로그램을 사용할 수 없습니다. 설치 상태를 확인해 주세요.",
  VIDEO_MERGE_FAILED: "로컬 영상 병합에 실패했습니다. 승인된 장면 영상은 그대로 보존됩니다.",
  VIDEO_STORAGE_ERROR: "영상 작업 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  VIDEO_MERGE_CONTENT_UNAVAILABLE: "최종 영상을 불러올 수 없습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message, details, or any filesystem path — only a fixed, safe message per code. */
/**
 * The one message that needs a number out of `details`.
 *
 * Every other code here maps to a fixed sentence, deliberately: the server's own text can carry file paths, so
 * none of it reaches the screen. This reads a single numeric field and formats it, which is not the same thing
 * as passing text through — and it is what turns "그 숫자는 안 됩니다" into "이 곡은 2분 8초까지입니다", the
 * sentence that actually tells someone what to do (CLI Round 457 put the length in `details` for exactly this).
 */
function audioStartOutOfRange(details: Record<string, unknown> | undefined): string {
  const seconds = details?.durationSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "고른 시작 지점이 곡 길이를 넘습니다. 더 앞쪽에서 다시 골라 주세요.";
  }
  const whole = Math.floor(seconds);
  return `고른 시작 지점이 곡 길이를 넘습니다. 이 곡은 ${Math.floor(whole / 60)}분 ${whole % 60}초까지입니다.`;
}

export function toVideoMergeDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof VideoMergeApiError)) return UNKNOWN;
  if (error.code === "AUDIO_START_OUT_OF_RANGE") return { code: error.code, message: audioStartOutOfRange(error.details) };
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

function isProject(value: unknown): value is MergeVideosResponse["project"] {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.topic === "string" &&
    isNonEmptyString(value.projectType) &&
    isNonEmptyString(value.workflowState) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    Array.isArray(value.scenes) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.errors)
  );
}

/** The only allowed final render marker — a fixed relative path, never a raw filesystem path. */
function isMergeVideosResponse(value: unknown): value is MergeVideosResponse {
  return isRecord(value) && isProject(value.project) && value.finalVideoPath === FINAL_VIDEO_RELATIVE_PATH;
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
 * Sends the single, explicit, already-confirmed request to render the final local video from
 * the six approved scene videos. This never contacts Runway, OpenAI, or any paid provider.
 * Only call this from the final step of an explicit user confirmation, never automatically.
 */
export async function mergeVideos(
  projectId: string,
  audio?: MergeAudioSettings,
  /**
   * A photo card's subtitle size and height. Sent only when the person actually moved a control, and refused
   * outright by the server for an ordinary project — so it is never passed "just in case".
   */
  subtitleLayout?: PhotoCardSubtitleLayout,
): Promise<MergeVideosResponse> {
  let response: Response;
  try {
    // Omitting the body entirely is not the same as sending an empty one: the server then keeps the project's
    // own narration/subtitle toggles, which is the right behaviour for a caller that has no opinion. Only a
    // caller that actually asked the user sends `audio` — and the same rule holds for `subtitleLayout`.
    const payload = { ...(audio ? { audio } : {}), ...(subtitleLayout ? { subtitleLayout } : {}) };
    response = await fetch(API_ROUTES.videoMerge(projectId), Object.keys(payload).length > 0
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
      : { method: "POST" });
  } catch {
    throw new VideoMergeApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new VideoMergeApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!isMergeVideosResponse(body)) throw new VideoMergeApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

/**
 * `cacheBuster` (e.g. the project's `updatedAt`) forces a refetch after a re-merge.
 *
 * The address of a project's final video never changes, so without one the browser happily replays the previous
 * cut — the person watches the old video and concludes the merge did nothing. The Episode player has taken one
 * since it was written; this one had the same problem and no answer for it.
 */
export function finalVideoContentUrl(projectId: string, cacheBuster?: string): string {
  const url = API_ROUTES.videoFinalContent(projectId);
  return cacheBuster ? `${url}?v=${encodeURIComponent(cacheBuster)}` : url;
}
