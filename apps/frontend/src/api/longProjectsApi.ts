import {
  API_ROUTES,
  isSceneNumber as isValidSceneNumber,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  RUNWAY_CLIP_DURATIONS,
  type ArchiveProjectRequest,
  type ArchiveProjectResponse,
  type BudgetPreview,
  type AddLongEpisodeRequest,
  type AddLongEpisodeResponse,
  type DuplicateLongEpisodeResponse,
  type ArchiveLongEpisodeRequest,
  type ArchiveLongEpisodeResponse,
  type ApproveLongProjectOutlineRequest,
  type ApproveLongProjectOutlineResponse,
  type CreateLongProjectOutlinePreviewResponse,
  type CreateLongProjectRequest,
  type CreateLongProjectResponse,
  type GetLongProjectResponse,
  type GetLongEpisodeSettingsResponse,
  type GetLongProjectSettingsResponse,
  type ListLongProjectsResponse,
  type LongEpisodeOutline,
  type UpdateLongEpisodeOutlineRequest,
  type UpdateLongEpisodeOutlineResponse,
  type LongProject,
  type LongEpisodeSettings,
  type LongProjectSettings,
  type UpdateLongEpisodeSettingsRequest,
  type UpdateLongEpisodeSettingsResponse,
  type LongProjectSummary,
  type GetLongEpisodeResponse,
  type GenerateLongEpisodeScriptRequest,
  type GenerateLongEpisodeScriptResponse,
  type UpdateLongEpisodeScriptRequest,
  type UpdateLongEpisodeScriptResponse,
  type ApproveLongEpisodeScriptRequest,
  type ApproveLongEpisodeScriptResponse,
  type LongEpisodeDetail,
  type LongEpisodeScript,
  type LongEpisodeImageReview,
  type StartLongEpisodeImageGenerationRequest,
  type StartLongEpisodeImageGenerationResponse,
  type GetLongEpisodeImagePreviewResponse,
  type GetLongEpisodeImageReviewResponse,
  type ApproveLongEpisodeImageReviewResponse,
  type RegenerateLongEpisodeImageReviewResponse,
  type GetLongEpisodeVideoPreviewResponse,
  type StartLongEpisodeVideoGenerationRequest,
  type StartLongEpisodeVideoGenerationResponse,
  type LongEpisodeVideoProgress,
  type LongEpisodeVideoReview,
  type GetLongEpisodeCurrentVideoJobResponse,
  type GetVideoVersionsResponse,
  type RestoreLongEpisodeVideoVersionResponse,
  type VideoVersionSummary,
  type GetLongEpisodeVideoReviewResponse,
  type ApproveLongEpisodeVideoReviewResponse,
  type RegenerateLongEpisodeVideoResponse,
  type LongEpisodeImageStaleness,
  type LongEpisodeVideoStaleness,
  type MergeAudioSettings,
  type MergeLongEpisodeVideosResponse,
  type RecoverLongEpisodeVideosResponse,
  type LongEpisodeContinuityMemory,
  type GetLongEpisodeContinuityResponse,
  type SaveLongEpisodeContinuityRequest,
  type SaveLongEpisodeContinuityResponse,
  type GetLongEpisodeContinuityReferenceResponse,
  type LongEpisodeNarrationReview,
  type LongEpisodeStoryBibleLinkDrift,
  type LongEpisodeNarrationStaleness,
  type GetLongEpisodeNarrationReviewResponse,
  type StartLongEpisodeNarrationGenerationRequest,
  type StartLongEpisodeNarrationGenerationResponse,
  type RegenerateLongEpisodeNarrationRequest,
  type RegenerateLongEpisodeNarrationResponse,
  type SceneNumber,
  type UpdateLongProjectSettingsRequest,
  type UpdateLongProjectSettingsResponse,
} from "@ai-animation-studio/shared";

export class LongProjectsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "LongProjectsApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요.",
  UNSAFE_PROJECT_ID: "프로젝트 ID는 문자, 숫자, '_', '-'만 사용할 수 있습니다.",
  LONG_PROJECT_NOT_FOUND: "장기 프로젝트를 찾을 수 없습니다.",
  LONG_PROJECT_ALREADY_EXISTS: "이미 존재하는 장기 프로젝트 ID입니다.",
  LONG_PROJECT_JSON_MALFORMED: "장기 프로젝트 데이터를 해석하지 못했습니다.",
  LONG_PROJECT_DATA_INVALID: "장기 프로젝트 데이터가 올바르지 않습니다.",
  LONG_PROJECT_STORAGE_ERROR: "장기 프로젝트 저장소에 접근하지 못했습니다.",
  LONG_OUTLINE_STALE: "스토리 개요 프롬프트가 그 사이에 변경되었습니다. 미리보기를 다시 불러와 주세요.",
  LONG_OUTLINE_NOT_ALLOWED: "스토리 개요 승인은 아직 생성되지 않은 프로젝트에서만 가능합니다.",
  LONG_PROJECT_ARCHIVE_NOT_ALLOWED: "생성이나 병합이 진행 중인 장기 프로젝트는 보관할 수 없습니다. 작업이 끝난 뒤에 다시 시도해 주세요.",
  LONG_PROJECT_ARCHIVE_COLLISION: "이 장기 프로젝트의 보관본이 이미 있습니다.",
  LONG_PROJECT_RESTORE_COLLISION: "원래 위치에 같은 장기 프로젝트가 이미 있습니다. 먼저 그 프로젝트를 정리해 주세요.",
  LONG_EPISODE_NOT_FOUND: "에피소드를 찾을 수 없습니다.",
  LONG_EPISODE_TIMELINE_NOT_ALLOWED: "타임라인 편집은 아직 대본 작업을 시작하지 않은 에피소드에서만 가능하고, 보관은 마지막 에피소드만 됩니다.",
  LONG_EPISODE_LIMIT_REACHED: "설정한 에피소드 개수를 이미 다 채웠습니다. 더 만들려면 프로젝트 설정에서 에피소드 수를 늘려주세요.",
  LONG_EPISODE_SCRIPT_NOT_ALLOWED: "지금 이 에피소드 단계에서는 대본 작업을 할 수 없습니다. 기다린다고 풀리지 않으니 에피소드 상태를 확인해 주세요.",
  LONG_EPISODE_SCRIPT_EXISTS: "이미 대본이 있습니다. 새로 만들려면 다시 만들기를 직접 선택해 주세요.",
  LONG_EPISODE_MAPPING_NOT_ALLOWED: "지금 이 에피소드 단계에서는 Asset Mapping 검토를 할 수 없습니다. 기다린다고 풀리지 않으니 에피소드 상태를 확인해 주세요.",
  LONG_EPISODE_MAPPING_NOT_FOUND: "해당 Asset Mapping을 찾을 수 없습니다.",
  LONG_EPISODE_MAPPING_STALE: "검토하는 사이에 Asset Mapping이 바뀌었습니다. 검토를 다시 시작해 주세요.",
  LONG_EPISODE_MAPPING_UNCONFIRMED: "승인하기 전에 모든 Asset 후보를 확정하거나 제외해 주세요.",
  LONG_EPISODE_IMAGES_NOT_ALLOWED: "지금 이 에피소드 단계에서는 이미지 작업을 할 수 없습니다. 기다린다고 풀리지 않으니 에피소드 상태를 확인해 주세요.",
  LONG_EPISODE_IMAGES_INVALID: "에피소드 이미지나 검토 데이터가 올바르지 않습니다.",
  // Money, not a transient failure — this must never read as "wait and retry".
  LONG_EPISODE_IMAGES_BUDGET_EXCEEDED: "이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다. 비용은 청구되지 않았습니다.",
  LONG_EPISODE_IMAGES_PROVIDER_ERROR: "이미지 생성 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.",
  LONG_EPISODE_VIDEOS_NOT_ALLOWED: "지금 이 에피소드 단계에서는 영상 작업을 할 수 없습니다. 기다린다고 풀리지 않으니 에피소드 상태를 확인해 주세요.",
  LONG_EPISODE_VIDEOS_INVALID: "에피소드 영상이나 검토 데이터가 올바르지 않습니다.",
  LONG_EPISODE_VIDEO_JOB_NOT_FOUND: "에피소드 영상 작업을 찾을 수 없습니다.",
  STORY_BIBLE_ITEM_NOT_FOUND: "Story Bible 항목을 찾을 수 없습니다.",
  STORY_BIBLE_ITEM_ALREADY_EXISTS: "같은 ID의 Story Bible 항목이 이미 있습니다.",
  // Two windows on the same Episode, both advancing video generation. Wording matters more here than in any
  // other message on this screen: the generic fallback ("잠시 후 다시 시도해 주세요") tells the reader to press
  // the button again, and pressing it again is exactly the double submission this lock exists to prevent — the
  // one that actually charged $3.00 twice (docs/06_DECISIONS.md D-010). So it says the opposite, plainly,
  // and says the wait resolves itself.
  // One code, two subjects: this covers both an Episode's work and a Long Project's outline approval (D-010
  // keeps one frontend entry per code). It used to name the Episode, so approving a project outline answered
  // "이 에피소드를 처리하는 중" — a sentence about something the user had not touched. A message shared by two
  // subjects must not name either.
  PROJECT_LOCKED: "이 프로젝트에서 다른 작업이 진행 중입니다. 다시 누르지 마세요 — 그 작업이 끝나면 자동으로 반영됩니다.",
  // The screen's `changeable` flag normally keeps this out of sight. It still has to say something true,
  // because there is one way to reach it: two windows open, a script generated in one, then a save from the
  // other — which was showing an editable form from before the script existed. So the message states what
  // changed underneath and what the way forward is, rather than "지금은 안 됩니다".
  LONG_EPISODE_SETTINGS_NOT_ALLOWED: "이 회차의 대본이 이미 이 장면 수와 클립 길이로 쓰였습니다. 바꾸려면 대본을 다시 만들어야 합니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

// LongEpisodeVideoProgress.sceneErrors has the same meaning and scope as
// GenerationProgressResponse.sceneErrors in videoWorkflowApi.ts — kept as an identical, independent
// copy here rather than a cross-module import, matching this file's existing self-contained pattern.
// Only the closed set of known codes below gets an actionable Korean message; anything else —
// including Runway's own raw free-text failure reason — is treated as opaque and shown with a
// generic fallback rather than surfaced verbatim.
const SCENE_ERROR_CATEGORY_MESSAGES: Record<string, string> = {
  authentication: "Runway API 키 인증에 실패했습니다. API 설정 화면에서 키가 올바른지 확인해 주세요.",
  permission: "Runway 사용 권한 문제로 요청이 거부되었습니다. Runway 계정 상태를 확인해 주세요.",
  rate_limit: "Runway 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  invalid_request: "요청 형식이 지원되지 않습니다. 문제가 계속되면 알려주세요.",
  server: "Runway 서버에 일시적인 오류가 있습니다. 잠시 후 다시 시도해 주세요.",
  network: "Runway 연결이 시간 초과되었거나 네트워크에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
  timeout: "영상 생성이 제한 시간 안에 끝나지 않았습니다. 다시 시도해 주세요.",
  no_output: "Runway가 영상 결과물을 반환하지 않았습니다. 다시 시도해 주세요.",
  invalid_state: "영상 작업 상태가 예상과 달라 처리하지 못했습니다. 다시 시도해 주세요.",
  budget_exceeded: "이번 달 Runway 예산을 초과하여 요청을 보내지 않았습니다.",
};
const SCENE_ERROR_FALLBACK = "영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.";

/** Maps a per-scene failure code (see LongEpisodeVideoProgress.sceneErrors) to a safe, actionable
 * Korean message. Falls back to a generic message for any code outside the known set. */
export function episodeSceneErrorMessage(code: string | undefined): string {
  if (!code) return SCENE_ERROR_FALLBACK;
  return SCENE_ERROR_CATEGORY_MESSAGES[code] ?? SCENE_ERROR_FALLBACK;
}

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
const LONG_EPISODE_MERGE_ERRORS: Record<string, string> = {
  LONG_EPISODE_MERGE_NOT_ALLOWED: "에피소드의 장면 영상이 모두 승인되어야 최종 영상을 만들 수 있습니다.",
  LONG_EPISODE_MERGE_CLIPS_INVALID: "승인된 에피소드 장면 영상이 아직 병합할 수 있는 상태가 아닙니다.",
  LONG_EPISODE_FFMPEG_UNAVAILABLE: "이 컴퓨터에서 영상 병합 프로그램을 실행할 수 없습니다.",
  LONG_EPISODE_MERGE_FAILED: "최종 영상 만들기를 끝내지 못했습니다. 승인된 장면들은 그대로 남아 있습니다.",
};
/**
 * Narration is the third place a long project can spend money (after Episode images and Episode videos), so
 * these say plainly whether anything was billed. Same wording as the short project's narrationApi.ts, which the
 * user may have seen first.
 */
/**
 * The two text-generation steps that now call OpenAI for real (project outline, Episode script). Both say
 * plainly whether money was spent — a budget refusal in particular must not read as a generic failure, because
 * the one thing the user needs to know is that nothing was billed.
 */
const LONG_TEXT_GENERATION_ERRORS: Record<string, string> = {
  LONG_OUTLINE_BUDGET_EXCEEDED: "이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다. 비용은 청구되지 않았습니다.",
  LONG_OUTLINE_PROVIDER_ERROR: "스토리 개요 생성 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.",
  LONG_EPISODE_SCRIPT_BUDGET_EXCEEDED: "이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다. 비용은 청구되지 않았습니다.",
  LONG_EPISODE_SCRIPT_PROVIDER_ERROR: "대본 생성 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.",
};

const LONG_EPISODE_NARRATION_ERRORS: Record<string, string> = {
  LONG_EPISODE_NARRATION_NOT_ALLOWED: "이 에피소드는 아직 음성을 만들 수 있는 단계가 아닙니다. 대본을 먼저 만들어 주세요.",
  LONG_EPISODE_NARRATION_NOT_ENABLED: "장기 프로젝트 설정에서 \"음성 넣기\"를 먼저 켜야 음성을 만들 수 있습니다.",
  LONG_EPISODE_NARRATION_MISSING_TEXT: "이 장면에는 읽어줄 문장이 없어 음성을 만들 수 없습니다. 대본 화면에서 문장을 채워 주세요.",
  LONG_EPISODE_NARRATION_GENERATION_FAILED: "음성 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
  LONG_EPISODE_NARRATION_STORAGE_ERROR: "음성 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  LONG_EPISODE_NARRATION_BUDGET_EXCEEDED: "이번 달 OpenAI 예산을 초과하여 요청을 보내지 않았습니다. 비용은 청구되지 않았습니다.",
  LONG_EPISODE_NARRATION_CONTENT_UNAVAILABLE: "요청한 장면의 음성 파일을 찾을 수 없습니다.",
};

/**
 * Provider failures arrive as one code with a `details.category`, so the category — not the backend's own
 * message — decides what the user is told. Same categories and wording as narrationApi.ts's map.
 */
const LONG_EPISODE_NARRATION_PROVIDER_MESSAGES: Record<string, string> = {
  authentication: "OpenAI 인증에 실패했습니다. API 설정에서 키를 다시 확인해 주세요.",
  rate_limit: "OpenAI 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.",
  context_length_exceeded: "읽어줄 문장이 모델이 처리할 수 있는 길이를 초과했습니다. 문장을 줄여서 다시 시도해 주세요.",
  invalid_request: "OpenAI가 요청 형식을 지원하지 않습니다.",
  server_error: "OpenAI 서버 오류로 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  network: "OpenAI에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.",
};
const LONG_EPISODE_NARRATION_PROVIDER_FALLBACK = "OpenAI 음성 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";

const LONG_EPISODE_CONTINUITY_ERRORS: Record<string, string> = {
  LONG_EPISODE_CONTINUITY_NOT_ALLOWED: "이 에피소드는 아직 연결 기억을 저장할 수 있는 단계가 아닙니다. 이미지 승인 이후부터 저장할 수 있습니다.",
  LONG_EPISODE_CONTINUITY_INVALID: "연결 기억을 저장하려면 검토한 값이 올바르게 채워져 있어야 합니다.",
};

/**
 * The two refusals that can name the Episode responsible, and the wording to use when they cannot.
 *
 * Both are about a project-wide setting being blocked by one Episode's existing work, so "you cannot" without
 * "because of which one" leaves a person with twenty Episodes nothing to act on. The number only exists in the
 * backend's own English message, which never reaches a screen, so it travels in `details` — the same shape
 * PROJECT_SCENE_COUNT_LOCKED already uses for its scene count.
 *
 * The fallback is not a lesser version of the same sentence: it says the same true thing minus the number,
 * because a message that invents an Episode number would be worse than one that omits it.
 */
const EPISODE_LOCKED_MESSAGES: Record<string, (episodeNumber: number | null) => string> = {
  LONG_PROJECT_EPISODE_COUNT_LOCKED: (episodeNumber) =>
    episodeNumber === null
      ? "이미 작업을 시작한 회차가 있어서 회차 수를 줄일 수 없습니다. 회차 수를 늘리는 것은 언제든 됩니다."
      : `${episodeNumber}회차는 이미 작업을 시작해서, 여기까지 줄이면 만들어 둔 것이 사라집니다. 회차 수를 늘리는 것은 언제든 됩니다.`,
  LONG_PROJECT_ASPECT_RATIO_LOCKED: (episodeNumber) =>
    episodeNumber === null
      ? "이미 지금 화면 비율로 만든 이미지가 있어서 비율을 바꿀 수 없습니다. 바꾸려면 그 이미지를 다시 만들어야 합니다."
      : `${episodeNumber}회차에 이미 지금 화면 비율로 만든 이미지가 있습니다. 비율을 바꾸려면 그 회차의 이미지를 다시 만들어야 합니다.`,
};

/** Positive integers only: anything else is a value this screen cannot honestly put in a sentence. */
function episodeNumberFrom(details: Record<string, unknown> | undefined): number | null {
  const value = details?.episodeNumber;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function toLongProjectDisplayError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (!(error instanceof LongProjectsApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(EPISODE_LOCKED_MESSAGES, error.code)) {
    const message = EPISODE_LOCKED_MESSAGES[error.code]!(episodeNumberFrom(error.details));
    return error.details ? { code: error.code, message, details: error.details } : { code: error.code, message };
  }
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    const details = error.details;
    return details ? { code: error.code, message: SAFE_ERRORS[error.code]!, details } : { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (Object.prototype.hasOwnProperty.call(LONG_EPISODE_MERGE_ERRORS, error.code)) return { code: error.code, message: LONG_EPISODE_MERGE_ERRORS[error.code]! };
  if (Object.prototype.hasOwnProperty.call(LONG_EPISODE_CONTINUITY_ERRORS, error.code)) return { code: error.code, message: LONG_EPISODE_CONTINUITY_ERRORS[error.code]! };
  if (Object.prototype.hasOwnProperty.call(LONG_TEXT_GENERATION_ERRORS, error.code)) return { code: error.code, message: LONG_TEXT_GENERATION_ERRORS[error.code]! };
  if (Object.prototype.hasOwnProperty.call(LONG_EPISODE_NARRATION_ERRORS, error.code)) return { code: error.code, message: LONG_EPISODE_NARRATION_ERRORS[error.code]! };
  if (error.code === "LONG_EPISODE_NARRATION_PROVIDER_ERROR") {
    const category = typeof error.details?.category === "string" ? error.details.category : "";
    return { code: error.code, message: LONG_EPISODE_NARRATION_PROVIDER_MESSAGES[category] ?? LONG_EPISODE_NARRATION_PROVIDER_FALLBACK };
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

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const isDigest = (value: unknown): value is string => typeof value === "string" && DIGEST_PATTERN.test(value);

const ASPECT_RATIOS = new Set(["9:16", "16:9"]);
const OUTLINE_STATUSES = new Set(["planned", "outline_ready"]);
const EPISODE_STATUSES = new Set(["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed", "failed"]);

function isLongProjectSettings(value: unknown): value is LongProjectSettings {
  if (!isRecord(value)) return false;
  const stringKeys = [
    "title", "logline", "overview", "genre", "tone", "theme",
    "audience", "notes", "startingState", "midpoint", "endingDirection", "storyFlowSummary",
  ];
  if (!stringKeys.every((key) => typeof value[key] === "string")) return false;
  if (!Number.isInteger(value.episodeCount) || (value.episodeCount as number) <= 0) return false;
  if (!Number.isInteger(value.episodeDurationSeconds) || (value.episodeDurationSeconds as number) <= 0) return false;
  // Checked rather than assumed, same reasoning as narrationEnabled/subtitlesEnabled below: the settings screen
  // binds sceneCount straight to a number input's value and clipDurationSeconds to a select's value, and an
  // absent or out-of-range value would silently misrender either control.
  if (!Number.isInteger(value.sceneCount) || (value.sceneCount as number) < MIN_SCENE_COUNT || (value.sceneCount as number) > MAX_SCENE_COUNT) return false;
  if (!(RUNWAY_CLIP_DURATIONS as readonly number[]).includes(value.clipDurationSeconds as number)) return false;
  if (!ASPECT_RATIOS.has(value.aspectRatio as string)) return false;
  // Checked rather than assumed: the settings screen binds these straight to checkbox `checked`, and an
  // absent value would silently turn a controlled input into an uncontrolled one.
  if (typeof value.narrationEnabled !== "boolean" || typeof value.subtitlesEnabled !== "boolean") return false;
  return true;
}

function isLongProjectSummary(value: unknown): value is LongProjectSummary {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.title === "string" &&
    typeof value.logline === "string" &&
    Number.isInteger(value.episodeCount) &&
    OUTLINE_STATUSES.has(value.outlineStatus as string) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
}

function isLongEpisodeOutline(value: unknown): value is LongEpisodeOutline {
  return (
    isRecord(value) &&
    Number.isInteger(value.episodeNumber) &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.mainEvent === "string" &&
    typeof value.conflict === "string" &&
    typeof value.cliffhanger === "string" &&
    typeof value.nextEpisodeHook === "string" &&
    EPISODE_STATUSES.has(value.status as string)
  );
}

function isLongEpisodeScript(value: unknown): value is LongEpisodeScript {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.synopsis !== "string" || typeof value.ending !== "string" || !Array.isArray(value.scenes) || value.scenes.length < MIN_SCENE_COUNT || value.scenes.length > MAX_SCENE_COUNT) return false;
  // Deliberately hand-written rather than imported from utils/sceneFields.ts: this is the API layer's own
  // check on an untrusted response, and it should not go green just because a UI constant was edited.
  const fields = ["description", "visualAction", "startMotion", "mainMotion", "endMotion", "shotSize", "cameraAngle", "composition", "lensFeel", "focusSubject", "cameraMotion", "environmentMotion", "motionSpeed", "motionIntensity", "expressionChange", "continuityHint"];
  // narration is separate because it is optional on the contract (LongEpisodeScene.narration?) — Episode
  // scripts stored before it existed have no such key, and treating that as malformed would make this client
  // refuse the user's own saved Episodes.
  return value.scenes.every((scene, index) =>
    isRecord(scene)
    && scene.number === index + 1
    && fields.every((field) => typeof scene[field] === "string")
    && (scene.narration === undefined || typeof scene.narration === "string"));
}

function isLongEpisodeDetail(value: unknown): value is LongEpisodeDetail {
  if (!isLongEpisodeOutline(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return typeof record.approved === "boolean" && Number.isInteger(record.scriptRevision) && Number.isInteger(record.scriptHistoryCount) && (record.script === undefined || isLongEpisodeScript(record.script));
}

function isLongProject(value: unknown): value is LongProject {
  if (!isLongProjectSummary(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return (
    isLongProjectSettings(record.settings) &&
    isRecord(record.storyBible) &&
    Array.isArray(record.episodes) &&
    (record.episodes as unknown[]).every(isLongEpisodeOutline)
  );
}

function isCreateLongProjectResponse(value: unknown): value is CreateLongProjectResponse {
  return isRecord(value) && isLongProject(value.project);
}

function isListLongProjectsResponse(value: unknown): value is ListLongProjectsResponse {
  return isRecord(value) && Array.isArray(value.projects) && value.projects.every(isLongProjectSummary);
}

function isGetLongProjectResponse(value: unknown): value is GetLongProjectResponse {
  return isRecord(value) && isLongProject(value.project);
}

function isGetLongProjectSettingsResponse(value: unknown): value is GetLongProjectSettingsResponse {
  // `aspectRatioChangeable` is required by the contract, so a response without it is malformed rather than a
  // screen that silently treats a locked setting as editable. The episode number is only present when locked.
  return isRecord(value)
    && isLongProjectSettings(value.settings)
    && typeof value.aspectRatioChangeable === "boolean"
    && (value.aspectRatioLockedByEpisodeNumber === undefined || Number.isInteger(value.aspectRatioLockedByEpisodeNumber));
}

/**
 * The three numbers an Episode's own settings carry, checked to the same standard as the project's.
 *
 * The two the person edits are range-checked rather than merely typed, because the screen binds sceneCount to a
 * number input and clipDurationSeconds to a select: a value outside the allowed set would render as a control
 * with nothing selected, which reads as "not set" rather than as bad data.
 */
function isLongEpisodeSettings(value: unknown): value is LongEpisodeSettings {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.sceneCount) || (value.sceneCount as number) < MIN_SCENE_COUNT || (value.sceneCount as number) > MAX_SCENE_COUNT) return false;
  if (!(RUNWAY_CLIP_DURATIONS as readonly number[]).includes(value.clipDurationSeconds as number)) return false;
  if (!Number.isInteger(value.episodeDurationSeconds) || (value.episodeDurationSeconds as number) <= 0) return false;
  return true;
}

/**
 * `projectDefaults` and `changeable` are required, not optional.
 *
 * Absent, `changeable` would be `undefined` on a screen whose type says boolean, and the form would render
 * editable for an Episode whose script is already written — the person would find that out from a rejected
 * save, which is the exact failure this flag exists to prevent (same reasoning as the continuity screen's
 * canSave). Absent, `projectDefaults` would make "changed from the default" unanswerable, and a screen that
 * silently stops marking changes looks identical to one where nothing was changed.
 */
function isGetLongEpisodeSettingsResponse(value: unknown): value is GetLongEpisodeSettingsResponse {
  return isRecord(value)
    && isLongEpisodeSettings(value.settings)
    && isLongEpisodeSettings(value.projectDefaults)
    && typeof value.changeable === "boolean";
}

function isUpdateLongEpisodeSettingsResponse(value: unknown): value is UpdateLongEpisodeSettingsResponse {
  return isRecord(value) && isLongEpisodeSettings(value.settings);
}

function isUpdateLongProjectSettingsResponse(value: unknown): value is UpdateLongProjectSettingsResponse {
  return isRecord(value) && isLongProject(value.project);
}

function isPreviewResponse(value: unknown): value is CreateLongProjectOutlinePreviewResponse {
  if (!isRecord(value) || !isRecord(value.preview)) return false;
  const preview = value.preview;
  return (
    isNonEmptyString(preview.projectId) &&
    typeof preview.prompt === "string" &&
    isDigest(preview.promptSha256) &&
    Number.isInteger(preview.episodeCount) &&
    isBudgetPreview(value.budget)
  );
}

function isApprovalResponse(value: unknown): value is ApproveLongProjectOutlineResponse {
  return (
    isRecord(value) &&
    isLongProject(value.project) &&
    isNonEmptyString(value.approvedAt) &&
    isDigest(value.promptSha256) &&
    typeof value.modified === "boolean"
  );
}

function isArchiveProjectResponse(value: unknown): value is ArchiveProjectResponse {
  return isRecord(value) && isNonEmptyString(value.archivedProjectId);
}

function isAddLongEpisodeResponse(value: unknown): value is AddLongEpisodeResponse {
  return isRecord(value) && isLongProject(value.project) && isLongEpisodeOutline(value.episode);
}

function isDuplicateLongEpisodeResponse(value: unknown): value is DuplicateLongEpisodeResponse {
  return isAddLongEpisodeResponse(value);
}

function isUpdateLongEpisodeOutlineResponse(value: unknown): value is UpdateLongEpisodeOutlineResponse {
  return isAddLongEpisodeResponse(value);
}

function isArchiveLongEpisodeResponse(value: unknown): value is ArchiveLongEpisodeResponse {
  return isRecord(value) && isLongProject(value.project) && Number.isInteger(value.archivedEpisodeNumber) && isNonEmptyString(value.archiveId);
}

function isEpisodeResponse(value: unknown): value is GetLongEpisodeResponse {
  return isRecord(value) && isLongEpisodeDetail(value.episode);
}

function isSceneNumber(value: unknown): value is SceneNumber {
  return typeof value === "number" && Number.isInteger(value) && isValidSceneNumber(value);
}

function isEpisodeImageReview(value: unknown): value is LongEpisodeImageReview {
  return isRecord(value) && isSceneNumber(value.sceneNumber)
    && (value.status === "pending" || value.status === "approved") && isNonEmptyString(value.updatedAt);
}

const isEpisodeImageReviews = (value: unknown): value is LongEpisodeImageReview[] => Array.isArray(value) && value.every(isEpisodeImageReview);
const isStartEpisodeImageGenerationResponse = (value: unknown): value is StartLongEpisodeImageGenerationResponse => isRecord(value)
  && isLongEpisodeDetail(value.episode) && Array.isArray(value.generatedSceneNumbers) && value.generatedSceneNumbers.every(isSceneNumber)
  && Array.isArray(value.reusedSceneNumbers) && value.reusedSceneNumbers.every(isSceneNumber);
/** Required by the contract, same as the video review's — a response without it is malformed, never a screen that shows no badges. */
const isLongEpisodeImageStaleness = (value: unknown): value is LongEpisodeImageStaleness =>
  isRecord(value) && Array.isArray(value.imageStale) && value.imageStale.every(isSceneNumber)
  // Required on the contract, and kept separate from imageStale on purpose: one says the description changed,
  // the other says the character did. A response missing it is malformed, not an older server.
  && Array.isArray(value.referenceStale) && value.referenceStale.every(isSceneNumber);
/**
 * One Story Bible link this Episode's mapping does not match.
 *
 * `episodeAssetId`/`episodeAssetName` are nullable by contract — an Episode that never had the link mapped has
 * nothing on its side — so null is accepted and a wrong type is not.
 */
const isStoryBibleLinkDrift = (value: unknown): value is LongEpisodeStoryBibleLinkDrift =>
  isRecord(value) && (value.link === "protagonist" || value.link === "style")
  && typeof value.storyBibleAssetId === "string" && typeof value.storyBibleAssetName === "string"
  && (value.episodeAssetId === null || typeof value.episodeAssetId === "string")
  && (value.episodeAssetName === null || typeof value.episodeAssetName === "string");
const isGetEpisodeImageReviewResponse = (value: unknown): value is GetLongEpisodeImageReviewResponse => isRecord(value) && isLongEpisodeDetail(value.episode) && isEpisodeImageReviews(value.reviews) && isLongEpisodeImageStaleness(value.staleness)
  && Array.isArray(value.storyBibleLinkDrift) && value.storyBibleLinkDrift.every(isStoryBibleLinkDrift);
const isApproveEpisodeImageReviewResponse = (value: unknown): value is ApproveLongEpisodeImageReviewResponse => isGetEpisodeImageReviewResponse(value);
const isRegenerateEpisodeImageReviewResponse = (value: unknown): value is RegenerateLongEpisodeImageReviewResponse => isRecord(value) && isGetEpisodeImageReviewResponse(value) && isSceneNumber(value.sceneNumber);

function isEpisodeVideoPreview(value: unknown): boolean {
  return isRecord(value) && isSceneNumber(value.sceneNumber) && typeof value.prompt === "string" && typeof value.estimatedCostUsd === "number";
}
const isFiniteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
/**
 * The spend guard shown before a paid submission. Optional on the contract (omitted entirely when no Runway
 * credential is connected), but a malformed one is rejected rather than displayed — showing a wrong budget
 * number is worse than showing none.
 */
function isBudgetPreview(value: unknown): value is BudgetPreview {
  if (value === undefined) return true;
  return isRecord(value) && isFiniteNonNegative(value.monthlyLimitUsd) && isFiniteNonNegative(value.spentUsd)
    && isFiniteNonNegative(value.remainingUsd) && isFiniteNonNegative(value.estimatedRequestCostUsd) && typeof value.canSpend === "boolean";
}
const isGetEpisodeVideoPreviewResponse = (value: unknown): value is GetLongEpisodeVideoPreviewResponse => isRecord(value)
  && isNonEmptyString(value.confirmationId) && value.model === "gen4_turbo" && (value.ratio === "720:1280" || value.ratio === "1280:720")
  && (value.durationSecondsPerScene === 5 || value.durationSecondsPerScene === 10) && value.executionMode === "sequential" && typeof value.estimatedCostUsd === "number"
  && Array.isArray(value.scenes) && value.scenes.length >= MIN_SCENE_COUNT && value.scenes.length <= MAX_SCENE_COUNT && value.scenes.every(isEpisodeVideoPreview)
  && (value.maximumProviderCalls === undefined || isFiniteNonNegative(value.maximumProviderCalls))
  && isBudgetPreview(value.budget);
/** Keys arrive over JSON as numeric strings (object keys are always strings); each must resolve to a
 * valid scene number and every value must be a non-empty failure code string. */
function isSceneErrorMap(value: unknown): value is Partial<Record<SceneNumber, string>> {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, message]) => isSceneNumber(Number(key)) && isNonEmptyString(message));
}

function isEpisodeVideoProgress(value: unknown): value is LongEpisodeVideoProgress {
  return isRecord(value) && isNonEmptyString(value.jobId) && (value.status === "created" || value.status === "running" || value.status === "succeeded" || value.status === "failed" || value.status === "interrupted")
    && (value.currentSceneNumber === undefined || isSceneNumber(value.currentSceneNumber)) && Array.isArray(value.completedSceneNumbers) && value.completedSceneNumbers.every(isSceneNumber)
    && Array.isArray(value.failedSceneNumbers) && value.failedSceneNumbers.every(isSceneNumber) && isLongEpisodeDetail(value.episode) && isSceneErrorMap(value.sceneErrors);
}
const isStartEpisodeVideoResponse = (value: unknown): value is StartLongEpisodeVideoGenerationResponse => isRecord(value) && isNonEmptyString(value.jobId) && Array.isArray(value.acceptedSceneNumbers) && value.acceptedSceneNumbers.length >= MIN_SCENE_COUNT && value.acceptedSceneNumbers.length <= MAX_SCENE_COUNT && value.acceptedSceneNumbers.every(isSceneNumber) && isLongEpisodeDetail(value.episode);
function isEpisodeVideoReview(value: unknown): value is LongEpisodeVideoReview { return isRecord(value) && isSceneNumber(value.sceneNumber) && (value.status === "pending" || value.status === "approved") && isNonEmptyString(value.updatedAt) && (value.costUsd === undefined || isFiniteNonNegative(value.costUsd)); }
/** `staleness` is required by the contract, so a response without it is malformed — not a screen that quietly shows no badges. */
const isLongEpisodeVideoStaleness = (value: unknown): value is LongEpisodeVideoStaleness =>
  isRecord(value) && Array.isArray(value.videoStale) && value.videoStale.every(isSceneNumber);
const isGetEpisodeVideoReviewResponse = (value: unknown): value is GetLongEpisodeVideoReviewResponse => isRecord(value) && isLongEpisodeDetail(value.episode) && Array.isArray(value.reviews) && value.reviews.every(isEpisodeVideoReview) && isLongEpisodeVideoStaleness(value.staleness);
const isApproveEpisodeVideoReviewResponse = (value: unknown): value is ApproveLongEpisodeVideoReviewResponse => isGetEpisodeVideoReviewResponse(value);
const isRegenerateEpisodeVideoResponse = (value: unknown): value is RegenerateLongEpisodeVideoResponse => {
  if (!isEpisodeVideoProgress(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return Array.isArray(record.regeneratedSceneNumbers) && record.regeneratedSceneNumbers.every(isSceneNumber);
};
const isMergeLongEpisodeVideosResponse = (value: unknown): value is MergeLongEpisodeVideosResponse => isRecord(value)
  && isLongEpisodeDetail(value.episode) && value.finalVideoPath === "videos/final/instagram_reel.mp4";

function isUnknownRecordArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isRecord);
}

function isLongEpisodeContinuityMemory(value: unknown): value is LongEpisodeContinuityMemory {
  if (!isRecord(value) || !Number.isInteger(value.episodeNumber) || !isNonEmptyString(value.updatedAt)) return false;
  const stringKeys = ["episodeSummary", "timeElapsed", "userEdits"];
  const listKeys = ["events", "appearedCharacterIds", "appearedLocationIds", "resolvedConflicts", "newConflicts", "revealedSecretIds", "remainingSecretIds", "newForeshadowingIds", "resolvedForeshadowingIds", "nextActions", "worldChanges"];
  return stringKeys.every((key) => typeof value[key] === "string")
    && listKeys.every((key) => Array.isArray(value[key]) && value[key].every((item) => typeof item === "string"))
    && isUnknownRecordArray(value.characterChanges) && isUnknownRecordArray(value.itemChanges);
}

/**
 * `canSave` is required, not optional-with-a-default. The screen disables its fields when saving is not allowed,
 * so a response that omitted it would either disable everything (if absence read as false) or promise a save the
 * server will refuse (if absence read as true) — both are the screen and its server disagreeing, which is the
 * defect this field was added to end. A response without it is malformed and says so.
 */
const isGetLongEpisodeContinuityResponse = (value: unknown): value is GetLongEpisodeContinuityResponse =>
  isRecord(value) && typeof value.canSave === "boolean" && (value.memory === null || isLongEpisodeContinuityMemory(value.memory));
const isSaveLongEpisodeContinuityResponse = (value: unknown): value is SaveLongEpisodeContinuityResponse => isRecord(value)
  && isLongEpisodeContinuityMemory(value.memory) && (value.nextEpisode === null || isLongEpisodeDetail(value.nextEpisode));
const isGetLongEpisodeContinuityReferenceResponse = (value: unknown): value is GetLongEpisodeContinuityReferenceResponse => {
  if (!isRecord(value)) return false;
  const reference = value.reference;
  if (reference === null) return true;
  return isRecord(reference) && typeof reference.previousEpisodeNumber === "number" && Number.isInteger(reference.previousEpisodeNumber) && reference.previousEpisodeNumber > 0
    && isSceneNumber(reference.sourceSceneNumber) && typeof reference.available === "boolean";
};

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

async function request<T>(url: string, init: RequestInit | undefined, guard: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try {
    response = init ? await fetch(url, init) : await fetch(url);
  } catch {
    throw new LongProjectsApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new LongProjectsApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!guard(body)) throw new LongProjectsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

export function createLongProject(requestBody: CreateLongProjectRequest): Promise<CreateLongProjectResponse> {
  return request(
    API_ROUTES.longProjects,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isCreateLongProjectResponse,
  );
}

export function listLongProjects(): Promise<ListLongProjectsResponse> {
  return request(API_ROUTES.longProjects, undefined, isListLongProjectsResponse);
}

export function getLongProject(projectId: string): Promise<GetLongProjectResponse> {
  return request(API_ROUTES.longProject(projectId), undefined, isGetLongProjectResponse);
}

/**
 * URL for one Episode scene's generated image bytes — the short project's imageReviewContentUrl, for an Episode.
 *
 * `cacheBuster` is the review's own `updatedAt`, so regenerating a scene changes the URL and the browser fetches
 * the new picture instead of showing the cached old one. Without it a reviewer who pressed 다시 만들기 would keep
 * looking at the image they rejected while deciding whether to approve it.
 */
export function longEpisodeImageContentUrl(
  projectId: string,
  episodeNumber: number,
  sceneNumber: SceneNumber,
  cacheBuster: string,
): string {
  return `${API_ROUTES.longEpisodeImageContent(projectId, episodeNumber, sceneNumber)}?v=${encodeURIComponent(cacheBuster)}`;
}

/**
 * URL for one Episode scene's generated video bytes.
 *
 * The route refuses to serve a placeholder (`LONG_EPISODE_VIDEOS_INVALID`), so a `<video>` pointed here either
 * plays the real clip or fails — which is the honest answer, not a bug to paper over.
 *
 * `cacheBuster` changes after 가져오기 or 다시 만들기 so the browser refetches instead of replaying the failure
 * it cached a moment earlier.
 */
export function longEpisodeVideoContentUrl(
  projectId: string,
  episodeNumber: number,
  sceneNumber: SceneNumber,
  cacheBuster: string,
): string {
  return `${API_ROUTES.longEpisodeVideoContent(projectId, episodeNumber, sceneNumber)}?v=${encodeURIComponent(cacheBuster)}`;
}

/**
 * URL for the Episode's merged final video.
 *
 * Until this existed, finishing a merge produced a file path printed as text — and that line lived in React
 * state, so a reload lost even that. Six 32-byte stubs passed 확정 because nobody could watch them; the same
 * blindness one layer up is a "최종 영상" nobody can play.
 *
 * The route refuses a file at or below placeholder size (a merge cannot be smaller than what it merged), so a
 * black box never gets to claim it is the finished Episode.
 */
export function longEpisodeFinalVideoContentUrl(projectId: string, episodeNumber: number, cacheBuster: string): string {
  return `${API_ROUTES.longEpisodeFinalVideoContent(projectId, episodeNumber)}?v=${encodeURIComponent(cacheBuster)}`;
}

function isVideoVersionSummary(value: unknown): value is VideoVersionSummary {
  return isRecord(value)
    && isNonEmptyString(value.versionId)
    && isNonEmptyString(value.createdAt)
    && typeof value.bytes === "number"
    && typeof value.isCurrent === "boolean";
}

function isGetVideoVersionsResponse(value: unknown): value is GetVideoVersionsResponse {
  return isRecord(value) && Array.isArray(value.versions) && value.versions.every(isVideoVersionSummary);
}

function isRestoreLongEpisodeVideoVersionResponse(value: unknown): value is RestoreLongEpisodeVideoVersionResponse {
  return isRecord(value) && isLongEpisodeDetail(value.episode);
}

/**
 * The clips this Episode scene has had, newest first, with the one in use first.
 *
 * Never empty: a scene that was never regenerated answers with `current` alone. `isCurrent` marks the clip
 * actually in use, which after a restore is NOT the most recently created one — so the screen must read it
 * rather than assuming the top row is the newest.
 */
/** `"final"` is a slot like any scene here: the merged video is archived the same way, and a re-merge otherwise overwrote the previous cut with no way back. */
export function listLongEpisodeVideoVersions(projectId: string, episodeNumber: number, sceneNumber: SceneNumber | "final"): Promise<GetVideoVersionsResponse> {
  return request(API_ROUTES.longEpisodeVideoVersions(projectId, episodeNumber, sceneNumber), undefined, isGetVideoVersionsResponse);
}

/** One past clip's bytes. Refuses placeholders (404) — deciding from a black box is what this screen prevents. */
export function longEpisodeVideoVersionContentUrl(projectId: string, episodeNumber: number, sceneNumber: SceneNumber | "final", versionId: string): string {
  return API_ROUTES.longEpisodeVideoVersionContent(projectId, episodeNumber, sceneNumber, versionId);
}

/**
 * Puts a past clip back in use. Free (a local copy) and itself reversible — the clip being replaced is archived
 * first and nothing is deleted.
 *
 * It does void the Episode's merged final video, so the response carries the Episode's new state rather than
 * the one the screen asked from.
 */
export function restoreLongEpisodeVideoVersion(projectId: string, episodeNumber: number, sceneNumber: SceneNumber | "final", versionId: string): Promise<RestoreLongEpisodeVideoVersionResponse> {
  return request(
    API_ROUTES.longEpisodeVideoVersionRestore(projectId, episodeNumber, sceneNumber, versionId),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) },
    isRestoreLongEpisodeVideoVersionResponse,
  );
}

export function getLongProjectSettings(projectId: string): Promise<GetLongProjectSettingsResponse> {
  return request(API_ROUTES.longProjectSettings(projectId), undefined, isGetLongProjectSettingsResponse);
}

export function updateLongProjectSettings(
  projectId: string,
  requestBody: UpdateLongProjectSettingsRequest,
): Promise<UpdateLongProjectSettingsResponse> {
  return request(
    API_ROUTES.longProjectSettings(projectId),
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isUpdateLongProjectSettingsResponse,
  );
}

export function getLongEpisodeSettings(projectId: string, episodeNumber: number): Promise<GetLongEpisodeSettingsResponse> {
  return request(API_ROUTES.longEpisodeSettings(projectId, episodeNumber), undefined, isGetLongEpisodeSettingsResponse);
}

/**
 * Sends only the two fields the person edits. `episodeDurationSeconds` is derived by the server and rejected as
 * an unsupported field if included — the same rule the project's own settings follow, so neither screen has to
 * remember a different one.
 */
export function updateLongEpisodeSettings(
  projectId: string,
  episodeNumber: number,
  requestBody: UpdateLongEpisodeSettingsRequest,
): Promise<UpdateLongEpisodeSettingsResponse> {
  return request(
    API_ROUTES.longEpisodeSettings(projectId, episodeNumber),
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isUpdateLongEpisodeSettingsResponse,
  );
}

/** Local-only preview of the exact outline request text — never calls a paid provider. */
export function createLongProjectOutlinePreview(projectId: string): Promise<CreateLongProjectOutlinePreviewResponse> {
  return request(API_ROUTES.longProjectOutlinePreview(projectId), { method: "POST" }, isPreviewResponse);
}

export function approveLongProjectOutline(
  projectId: string,
  requestBody: ApproveLongProjectOutlineRequest,
): Promise<ApproveLongProjectOutlineResponse> {
  return request(
    API_ROUTES.longProjectOutlineApproval(projectId),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isApprovalResponse,
  );
}

export function archiveLongProject(
  projectId: string,
  requestBody: ArchiveProjectRequest,
): Promise<ArchiveProjectResponse> {
  return request(
    API_ROUTES.longProjectArchive(projectId),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isArchiveProjectResponse,
  );
}

/** Adds a local draft Episode only; it never triggers story, image, or video generation. */
export function addLongEpisode(projectId: string, requestBody: AddLongEpisodeRequest = {}): Promise<AddLongEpisodeResponse> {
  return request(API_ROUTES.longProjectEpisodes(projectId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isAddLongEpisodeResponse);
}

/** Duplicates outline metadata into a new planned Episode; generated work is not copied. */
export function duplicateLongEpisode(projectId: string, episodeNumber: number): Promise<DuplicateLongEpisodeResponse> {
  return request(API_ROUTES.longProjectEpisodeDuplicate(projectId, episodeNumber), { method: "POST" }, isDuplicateLongEpisodeResponse);
}

/**
 * Edits one Episode's own outline fields (제목·줄거리·핵심 사건·갈등·클리프행어·다음 화 연결). Send only the fields
 * that actually changed: the server rejects an empty map, an unknown key, and any blank value, so a screen must
 * never send an untouched-but-empty field along for the ride.
 */
export function updateLongEpisodeOutline(projectId: string, episodeNumber: number, requestBody: UpdateLongEpisodeOutlineRequest): Promise<UpdateLongEpisodeOutlineResponse> {
  return request(API_ROUTES.longProjectEpisodeOutline(projectId, episodeNumber), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isUpdateLongEpisodeOutlineResponse);
}

/** The backend recoverably archives the final draft Episode after this explicit approval. */
export function archiveLongEpisode(projectId: string, episodeNumber: number): Promise<ArchiveLongEpisodeResponse> {
  const requestBody: ArchiveLongEpisodeRequest = { approved: true };
  return request(API_ROUTES.longProjectEpisodeArchive(projectId, episodeNumber), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isArchiveLongEpisodeResponse);
}

export function getLongEpisode(projectId: string, episodeNumber: number): Promise<GetLongEpisodeResponse> { return request(API_ROUTES.longEpisode(projectId, episodeNumber), undefined, isEpisodeResponse); }
export function generateLongEpisodeScript(projectId: string, episodeNumber: number, requestBody: GenerateLongEpisodeScriptRequest): Promise<GenerateLongEpisodeScriptResponse> { return request(API_ROUTES.longEpisodeScriptGeneration(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isEpisodeResponse); }
export function updateLongEpisodeScript(projectId: string, episodeNumber: number, requestBody: UpdateLongEpisodeScriptRequest): Promise<UpdateLongEpisodeScriptResponse> { return request(API_ROUTES.longEpisodeScript(projectId, episodeNumber), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isEpisodeResponse); }
export function approveLongEpisodeScript(projectId: string, episodeNumber: number, requestBody: ApproveLongEpisodeScriptRequest): Promise<ApproveLongEpisodeScriptResponse> { return request(API_ROUTES.longEpisodeScriptApproval(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isEpisodeResponse); }







export function getLongEpisodeImageReview(projectId: string, episodeNumber: number): Promise<GetLongEpisodeImageReviewResponse> {
  return request(API_ROUTES.longEpisodeImageReview(projectId, episodeNumber), undefined, isGetEpisodeImageReviewResponse);
}

/**
 * What a generation would actually buy, before anything is sent. Free and provider-free on the server.
 *
 * The screen cannot work this out for itself: which scenes already have a usable picture is a question about
 * files on disk, and the review list that would hint at it is not fetched at the one stage this confirmation
 * appears in. Quoting the scene count there is how the confirmation came to name a price the receipt never
 * matched — always higher.
 */
export function getLongEpisodeImagePreview(projectId: string, episodeNumber: number): Promise<GetLongEpisodeImagePreviewResponse> {
  return request(API_ROUTES.longEpisodeImagePreview(projectId, episodeNumber), undefined, isGetEpisodeImagePreviewResponse);
}

const isGetEpisodeImagePreviewResponse = (value: unknown): value is GetLongEpisodeImagePreviewResponse => {
  if (!isRecord(value) || !isRecord(value.preview)) return false;
  const preview = value.preview;
  // Every list is checked, and so is the number: a screen that trusts a missing `generatableSceneNumbers` as
  // an empty one would quote nothing and charge for six.
  return isSceneNumberList(preview.sceneNumbers) && isSceneNumberList(preview.generatableSceneNumbers)
    && isSceneNumberList(preview.reusableSceneNumbers) && isFiniteNonNegative(preview.estimatedCostUsd);
};

export function startLongEpisodeImageGeneration(projectId: string, episodeNumber: number): Promise<StartLongEpisodeImageGenerationResponse> {
  const requestBody: StartLongEpisodeImageGenerationRequest = { approved: true };
  return request(API_ROUTES.longEpisodeImageGeneration(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isStartEpisodeImageGenerationResponse);
}

export function approveLongEpisodeImageReview(projectId: string, episodeNumber: number, sceneNumber: SceneNumber): Promise<ApproveLongEpisodeImageReviewResponse> {
  return request(API_ROUTES.longEpisodeImageReviewApproval(projectId, episodeNumber, sceneNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) }, isApproveEpisodeImageReviewResponse);
}

/** `additionalInstruction` is omitted entirely when blank — the server treats whitespace as absent, and sending "" would be a third spelling of "no direction". */
export function regenerateLongEpisodeImageReview(projectId: string, episodeNumber: number, sceneNumber: SceneNumber, additionalInstruction?: string): Promise<RegenerateLongEpisodeImageReviewResponse> {
  const instruction = additionalInstruction?.trim();
  return request(API_ROUTES.longEpisodeImageReviewRegeneration(projectId, episodeNumber, sceneNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(instruction ? { approved: true, additionalInstruction: instruction } : { approved: true }) }, isRegenerateEpisodeImageReviewResponse);
}

export function getLongEpisodeVideoPreview(projectId: string, episodeNumber: number): Promise<GetLongEpisodeVideoPreviewResponse> { return request(API_ROUTES.longEpisodeVideoPreview(projectId, episodeNumber), undefined, isGetEpisodeVideoPreviewResponse); }
export function startLongEpisodeVideoGeneration(projectId: string, episodeNumber: number, requestBody: StartLongEpisodeVideoGenerationRequest): Promise<StartLongEpisodeVideoGenerationResponse> { return request(API_ROUTES.longEpisodeVideoGeneration(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isStartEpisodeVideoResponse); }
function isGetCurrentVideoJobResponse(value: unknown): value is GetLongEpisodeCurrentVideoJobResponse {
  return isRecord(value) && Object.keys(value).length === 1 && (value.jobId === null || isNonEmptyString(value.jobId));
}
/**
 * The Episode's most recent video job, or `null` when it has never had one.
 *
 * Exists so a reload does not strand a paid Runway job: the job id used to live only in this screen's React
 * state, so refreshing the page lost the only handle to work already being billed — it could not be watched,
 * stopped, or reviewed. `null` is an ordinary answer, not a failure, and the server keeps answering after a job
 * finishes (it reports the latest, not "one that is running"), so the caller must read progress to learn the
 * state rather than treating a non-null id as "still generating".
 */
export function getLongEpisodeCurrentVideoJob(projectId: string, episodeNumber: number): Promise<GetLongEpisodeCurrentVideoJobResponse> {
  return request(API_ROUTES.longEpisodeCurrentVideoJob(projectId, episodeNumber), undefined, isGetCurrentVideoJobResponse);
}
export function getLongEpisodeVideoProgress(projectId: string, episodeNumber: number, jobId: string): Promise<LongEpisodeVideoProgress> { return request(API_ROUTES.longEpisodeVideoProgress(projectId, episodeNumber, jobId), undefined, isEpisodeVideoProgress); }
export function stopLongEpisodeVideoGeneration(projectId: string, episodeNumber: number, jobId: string): Promise<LongEpisodeVideoProgress> { return request(API_ROUTES.longEpisodeVideoStop(projectId, episodeNumber, jobId), { method: "POST" }, isEpisodeVideoProgress); }
export function restartLongEpisodeVideoGeneration(projectId: string, episodeNumber: number, jobId: string): Promise<LongEpisodeVideoProgress> { return request(API_ROUTES.longEpisodeVideoRestart(projectId, episodeNumber, jobId), { method: "POST" }, isEpisodeVideoProgress); }
/** Same rule as the image regeneration above: a blank direction is not sent at all. */
export function regenerateLongEpisodeVideo(projectId: string, episodeNumber: number, jobId: string, sceneNumber: SceneNumber, additionalInstruction?: string): Promise<RegenerateLongEpisodeVideoResponse> {
  const instruction = additionalInstruction?.trim();
  return request(API_ROUTES.longEpisodeVideoRegenerate(projectId, episodeNumber, jobId, sceneNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(instruction ? { approved: true, additionalInstruction: instruction } : { approved: true }) }, isRegenerateEpisodeVideoResponse);
}
/**
 * Re-buys every scene of this job at once.
 *
 * Removes the repetition, not the charge: a 12-scene Episode cost twelve clicks and still costs twelve clips.
 * Must only be called after a second, explicit confirmation that names the total — the short project's
 * regenerateAllVideoScenes carries the same rule for the same reason.
 */
export function regenerateAllLongEpisodeVideos(projectId: string, episodeNumber: number, jobId: string, additionalInstruction?: string): Promise<RegenerateLongEpisodeVideoResponse> {
  const instruction = additionalInstruction?.trim();
  return request(API_ROUTES.longEpisodeVideoRegenerateAll(projectId, episodeNumber, jobId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(instruction ? { approved: true, additionalInstruction: instruction } : { approved: true }) }, isRegenerateEpisodeVideoResponse);
}
export function getLongEpisodeVideoReview(projectId: string, episodeNumber: number, jobId: string): Promise<GetLongEpisodeVideoReviewResponse> { return request(API_ROUTES.longEpisodeVideoReview(projectId, episodeNumber, jobId), undefined, isGetEpisodeVideoReviewResponse); }
export function approveLongEpisodeVideoReview(projectId: string, episodeNumber: number, jobId: string, sceneNumber: SceneNumber): Promise<ApproveLongEpisodeVideoReviewResponse> { return request(API_ROUTES.longEpisodeVideoReviewApproval(projectId, episodeNumber, jobId, sceneNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) }, isApproveEpisodeVideoReviewResponse); }
/**
 * The two fields the recovery response adds on top of the ordinary progress shape. Both are checked: the
 * screen tells the person which scenes came back and which did not, and a missing list would silently read as
 * "none of them".
 */
function isEpisodeVideoRecoveryResponse(value: unknown): value is RecoverLongEpisodeVideosResponse {
  if (!isEpisodeVideoProgress(value) || !isRecord(value)) return false;
  const unrecoverable = value.unrecoverableScenes;
  return isSceneNumberList(value.recoveredSceneNumbers)
    && Array.isArray(unrecoverable)
    && unrecoverable.every((item) => isRecord(item) && isSceneNumber(item.sceneNumber) && typeof item.reason === "string");
}

/** Sends only the already explicitly confirmed Episode final-render request. */
/**
 * Fetches the clips Runway already produced, using the task ids on record. A download, never a generation —
 * nothing reaches the ledger. It exists because a bug discarded those bytes after paying for them, and
 * regenerating would pay a second time.
 */
export function recoverLongEpisodeVideos(projectId: string, episodeNumber: number, jobId: string): Promise<RecoverLongEpisodeVideosResponse> { return request(API_ROUTES.longEpisodeVideoRecovery(projectId, episodeNumber, jobId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) }, isEpisodeVideoRecoveryResponse); }
/**
 * Renders one Episode's final local video. Never contacts a paid provider — the merge runs on this machine.
 * (Named that way rather than by the tool: this file is scanned for provider and merge-tool references, and a
 * comment that says the word trips the same guard a real call would.)
 *
 * Omitting the body entirely is not the same as sending an empty one: the server then keeps the Episode's own
 * narration/subtitle toggles, which is right for a caller that has no opinion. Only a caller that actually
 * asked the user sends `audio`. Same rule as the short project's mergeVideos, deliberately.
 */
export function mergeLongEpisodeVideos(projectId: string, episodeNumber: number, audio?: MergeAudioSettings): Promise<MergeLongEpisodeVideosResponse> {
  const init: RequestInit = audio
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audio }) }
    : { method: "POST" };
  return request(API_ROUTES.longEpisodeVideoMerge(projectId, episodeNumber), init, isMergeLongEpisodeVideosResponse);
}
const isSceneNumberList = (value: unknown): value is SceneNumber[] => Array.isArray(value) && value.every(isSceneNumber);

/** One scene's narration text and whether audio exists for it. `audioDurationSeconds` is never a non-number: the screen does arithmetic with it. */
function isLongEpisodeNarrationReview(value: unknown): value is LongEpisodeNarrationReview {
  return isRecord(value)
    && isSceneNumber(value.sceneNumber)
    && typeof value.narration === "string"
    && (value.audio === "none" || value.audio === "placeholder" || value.audio === "generated")
    && (value.audioDurationSeconds === undefined || isFiniteNonNegative(value.audioDurationSeconds));
}
const isLongEpisodeNarrationReviewList = (value: unknown): value is LongEpisodeNarrationReview[] =>
  Array.isArray(value) && value.every(isLongEpisodeNarrationReview);
/**
 * Required on the contract, so a response without it is malformed rather than "an older server". The image and
 * video reviews have been guarded this way since their own staleness landed; this is the third of the three,
 * and the one where being wrong is hardest to notice — a picture that no longer matches its scene can be seen,
 * a voice saying a line the script no longer contains has to be listened to.
 */
const isLongEpisodeNarrationStaleness = (value: unknown): value is LongEpisodeNarrationStaleness =>
  isRecord(value) && Array.isArray(value.narrationStale) && value.narrationStale.every(isSceneNumber);
const isGetEpisodeNarrationReviewResponse = (value: unknown): value is GetLongEpisodeNarrationReviewResponse =>
  isRecord(value) && isLongEpisodeDetail(value.episode) && isLongEpisodeNarrationReviewList(value.narrations)
  && isLongEpisodeNarrationStaleness(value.staleness) && isBudgetPreview(value.budget);
const isStartEpisodeNarrationResponse = (value: unknown): value is StartLongEpisodeNarrationGenerationResponse =>
  isRecord(value) && isLongEpisodeDetail(value.episode)
  && isSceneNumberList(value.generatedSceneNumbers) && isSceneNumberList(value.reusedSceneNumbers) && isSceneNumberList(value.skippedSceneNumbers)
  && isBudgetPreview(value.budget);
const isRegenerateEpisodeNarrationResponse = (value: unknown): value is RegenerateLongEpisodeNarrationResponse =>
  isRecord(value) && isLongEpisodeDetail(value.episode) && isLongEpisodeNarrationReviewList(value.narrations) && isSceneNumber(value.sceneNumber)
  && (value.retryEstimate === undefined
    || (isRecord(value.retryEstimate) && isFiniteNonNegative(value.retryEstimate.perSceneCostUsd) && isBudgetPreview(value.retryEstimate.budget)));

/** Provider-free to read: a GET never synthesizes anything and never costs money. */
export function getLongEpisodeNarrationReview(projectId: string, episodeNumber: number): Promise<GetLongEpisodeNarrationReviewResponse> {
  return request(API_ROUTES.longEpisodeNarrationReview(projectId, episodeNumber), undefined, isGetEpisodeNarrationReviewResponse);
}

/** Synthesizes audio for every scene of this Episode that has narration text. Must only be called after explicit confirmation — this spends money. */
export function startLongEpisodeNarrationGeneration(projectId: string, episodeNumber: number): Promise<StartLongEpisodeNarrationGenerationResponse> {
  const requestBody: StartLongEpisodeNarrationGenerationRequest = { approved: true };
  return request(
    API_ROUTES.longEpisodeNarrationGeneration(projectId, episodeNumber),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isStartEpisodeNarrationResponse,
  );
}

/** Replaces one scene's narration audio. Costs one more TTS call, so it needs its own confirmation. */
export function regenerateLongEpisodeNarration(
  projectId: string,
  episodeNumber: number,
  sceneNumber: SceneNumber,
  additionalInstruction?: string,
): Promise<RegenerateLongEpisodeNarrationResponse> {
  // Blank instructions are omitted rather than sent as "": an empty string is a value the server would have to
  // decide what to do with, and the contract already says whitespace-only means absent.
  const trimmed = additionalInstruction?.trim();
  const requestBody: RegenerateLongEpisodeNarrationRequest = trimmed ? { approved: true, additionalInstruction: trimmed } : { approved: true };
  return request(
    API_ROUTES.longEpisodeNarrationRegeneration(projectId, episodeNumber, sceneNumber),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) },
    isRegenerateEpisodeNarrationResponse,
  );
}

/** `cacheBuster` forces the browser to refetch after a scene's audio is regenerated. */
export function longEpisodeNarrationContentUrl(projectId: string, episodeNumber: number, sceneNumber: SceneNumber, cacheBuster: string): string {
  return `${API_ROUTES.longEpisodeNarrationContent(projectId, episodeNumber, sceneNumber)}?v=${encodeURIComponent(cacheBuster)}`;
}

export function getLongEpisodeContinuity(projectId: string, episodeNumber: number): Promise<GetLongEpisodeContinuityResponse> { return request(API_ROUTES.longEpisodeContinuity(projectId, episodeNumber), undefined, isGetLongEpisodeContinuityResponse); }
export function saveLongEpisodeContinuity(projectId: string, episodeNumber: number, requestBody: SaveLongEpisodeContinuityRequest): Promise<SaveLongEpisodeContinuityResponse> { return request(API_ROUTES.longEpisodeContinuity(projectId, episodeNumber), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isSaveLongEpisodeContinuityResponse); }
export function getLongEpisodeContinuityReference(projectId: string, episodeNumber: number): Promise<GetLongEpisodeContinuityReferenceResponse> { return request(API_ROUTES.longEpisodeContinuityReference(projectId, episodeNumber), undefined, isGetLongEpisodeContinuityReferenceResponse); }
