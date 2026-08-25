import {
  API_ROUTES,
  isSceneNumber as isValidSceneNumber,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
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
  type GetLongProjectSettingsResponse,
  type ListLongProjectsResponse,
  type LongEpisodeOutline,
  type LongProject,
  type LongProjectSettings,
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
  type LongEpisodeAssetMappingCandidate,
  type LongEpisodeAssetMappingReview,
  type GetLongEpisodeAssetMappingReviewResponse,
  type BeginLongEpisodeAssetMappingReviewRequest,
  type BeginLongEpisodeAssetMappingReviewResponse,
  type UpdateLongEpisodeAssetMappingRequest,
  type UpdateLongEpisodeAssetMappingResponse,
  type ApproveLongEpisodeAssetMappingReviewRequest,
  type ApproveLongEpisodeAssetMappingReviewResponse,
  type LongEpisodeAutomaticReferenceSummary,
  type GetLongEpisodeAutomaticReferenceSummaryResponse,
  type RerunLongEpisodeAssetMatchingResponse,
  type LongEpisodeImageReview,
  type StartLongEpisodeImageGenerationRequest,
  type StartLongEpisodeImageGenerationResponse,
  type GetLongEpisodeImageReviewResponse,
  type ApproveLongEpisodeImageReviewResponse,
  type RegenerateLongEpisodeImageReviewResponse,
  type GetLongEpisodeVideoPreviewResponse,
  type StartLongEpisodeVideoGenerationRequest,
  type StartLongEpisodeVideoGenerationResponse,
  type LongEpisodeVideoProgress,
  type LongEpisodeVideoReview,
  type GetLongEpisodeVideoReviewResponse,
  type ApproveLongEpisodeVideoReviewResponse,
  type RegenerateLongEpisodeVideoResponse,
  type MergeLongEpisodeVideosResponse,
  type LongEpisodeContinuityMemory,
  type GetLongEpisodeContinuityResponse,
  type SaveLongEpisodeContinuityRequest,
  type SaveLongEpisodeContinuityResponse,
  type GetLongEpisodeContinuityReferenceResponse,
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
const LONG_EPISODE_CONTINUITY_ERRORS: Record<string, string> = {
  LONG_EPISODE_CONTINUITY_NOT_ALLOWED: "이 에피소드는 아직 연결 기억을 저장할 수 있는 단계가 아닙니다. 이미지 승인 이후부터 저장할 수 있습니다.",
  LONG_EPISODE_CONTINUITY_INVALID: "연결 기억을 저장하려면 검토한 값이 올바르게 채워져 있어야 합니다.",
};

export function toLongProjectDisplayError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (!(error instanceof LongProjectsApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    const details = error.details;
    return details ? { code: error.code, message: SAFE_ERRORS[error.code]!, details } : { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (Object.prototype.hasOwnProperty.call(LONG_EPISODE_MERGE_ERRORS, error.code)) return { code: error.code, message: LONG_EPISODE_MERGE_ERRORS[error.code]! };
  if (Object.prototype.hasOwnProperty.call(LONG_EPISODE_CONTINUITY_ERRORS, error.code)) return { code: error.code, message: LONG_EPISODE_CONTINUITY_ERRORS[error.code]! };
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

const PLATFORMS = new Set(["YouTube Shorts", "YouTube"]);
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
  if (!PLATFORMS.has(value.platform as string)) return false;
  if (!ASPECT_RATIOS.has(value.aspectRatio as string)) return false;
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
  const fields = ["description", "visualAction", "startMotion", "mainMotion", "endMotion", "shotSize", "cameraAngle", "composition", "lensFeel", "focusSubject", "cameraMotion", "environmentMotion", "motionSpeed", "motionIntensity", "expressionChange", "continuityHint"];
  return value.scenes.every((scene, index) => isRecord(scene) && scene.number === index + 1 && fields.every((field) => typeof scene[field] === "string"));
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
  return isRecord(value) && isLongProjectSettings(value.settings);
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
    Number.isInteger(preview.episodeCount)
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

function isArchiveLongEpisodeResponse(value: unknown): value is ArchiveLongEpisodeResponse {
  return isRecord(value) && isLongProject(value.project) && Number.isInteger(value.archivedEpisodeNumber) && isNonEmptyString(value.archiveId);
}

function isEpisodeResponse(value: unknown): value is GetLongEpisodeResponse {
  return isRecord(value) && isLongEpisodeDetail(value.episode);
}

function isEpisodeCandidate(value: unknown): value is LongEpisodeAssetMappingCandidate {
  if (!isRecord(value) || !isNonEmptyString(value.mappingId) || !isNonEmptyString(value.assetId) || !isNonEmptyString(value.sourceItemId)) return false;
  if (value.sourceCollection !== "basic" && value.sourceCollection !== "characters" && value.sourceCollection !== "locations" && value.sourceCollection !== "props") return false;
  if (value.usageRole !== "character" && value.usageRole !== "background" && value.usageRole !== "object" && value.usageRole !== "style") return false;
  if (value.versionPolicy !== "pinned_version" && value.versionPolicy !== "follow_latest" && value.versionPolicy !== "snapshot") return false;
  if (value.pinnedVersion !== null && (!Number.isInteger(value.pinnedVersion) || (value.pinnedVersion as number) <= 0)) return false;
  if (!isRecord(value.episodeScope) || (value.episodeScope.mode !== "all" && (value.episodeScope.mode !== "episode" || !Number.isInteger(value.episodeScope.episode)))) return false;
  return (value.status === "suggested" || value.status === "confirmed" || value.status === "excluded") && typeof value.userConfirmed === "boolean";
}

function isEpisodeMappingReview(value: unknown): value is LongEpisodeAssetMappingReview {
  return isRecord(value) && isNonEmptyString(value.projectId) && Number.isInteger(value.episodeNumber) && Number.isInteger(value.mappingRevision)
    && Number.isInteger(value.scriptRevision) && isDigest(value.scriptFingerprint) && (value.status === "waiting" || value.status === "approved")
    && typeof value.textOnlyConfirmed === "boolean" && Array.isArray(value.candidates) && value.candidates.every(isEpisodeCandidate);
}

const isGetEpisodeMappingReviewResponse = (value: unknown): value is GetLongEpisodeAssetMappingReviewResponse => isRecord(value) && isEpisodeMappingReview(value.review);
const isBeginEpisodeMappingReviewResponse = (value: unknown): value is BeginLongEpisodeAssetMappingReviewResponse => isGetEpisodeMappingReviewResponse(value);
const isUpdateEpisodeMappingResponse = (value: unknown): value is UpdateLongEpisodeAssetMappingResponse => isRecord(value) && isEpisodeCandidate(value.mapping) && isEpisodeMappingReview(value.review);
const isApproveEpisodeMappingResponse = (value: unknown): value is ApproveLongEpisodeAssetMappingReviewResponse => isRecord(value) && isEpisodeMappingReview(value.review) && isLongEpisodeDetail(value.episode);

function isAutomaticReferenceSummary(value: unknown): value is LongEpisodeAutomaticReferenceSummary {
  if (!isRecord(value) || !Array.isArray(value.candidateAssetIds) || !value.candidateAssetIds.every(isNonEmptyString)
    || !isRecord(value.selectedAssetIdsByScene) || !Number.isInteger(value.estimatedImageApiCalls) || (value.estimatedImageApiCalls as number) < 0) return false;
  const selections = value.selectedAssetIdsByScene as Record<string, unknown>;
  return Object.entries(selections).every(([key, selection]) => isSceneNumber(Number(key)) && Array.isArray(selection) && selection.every(isNonEmptyString));
}
const isGetAutomaticReferenceSummaryResponse = (value: unknown): value is GetLongEpisodeAutomaticReferenceSummaryResponse => isRecord(value) && isAutomaticReferenceSummary(value.summary);
const isRerunEpisodeAssetMatchingResponse = (value: unknown): value is RerunLongEpisodeAssetMatchingResponse => isRecord(value) && isEpisodeMappingReview(value.review) && isLongEpisodeDetail(value.episode);

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
const isGetEpisodeImageReviewResponse = (value: unknown): value is GetLongEpisodeImageReviewResponse => isRecord(value) && isLongEpisodeDetail(value.episode) && isEpisodeImageReviews(value.reviews);
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
const isGetEpisodeVideoReviewResponse = (value: unknown): value is GetLongEpisodeVideoReviewResponse => isRecord(value) && isLongEpisodeDetail(value.episode) && Array.isArray(value.reviews) && value.reviews.every(isEpisodeVideoReview);
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

const isGetLongEpisodeContinuityResponse = (value: unknown): value is GetLongEpisodeContinuityResponse => isRecord(value) && (value.memory === null || isLongEpisodeContinuityMemory(value.memory));
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

/** The backend recoverably archives the final draft Episode after this explicit approval. */
export function archiveLongEpisode(projectId: string, episodeNumber: number): Promise<ArchiveLongEpisodeResponse> {
  const requestBody: ArchiveLongEpisodeRequest = { approved: true };
  return request(API_ROUTES.longProjectEpisodeArchive(projectId, episodeNumber), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isArchiveLongEpisodeResponse);
}

export function getLongEpisode(projectId: string, episodeNumber: number): Promise<GetLongEpisodeResponse> { return request(API_ROUTES.longEpisode(projectId, episodeNumber), undefined, isEpisodeResponse); }
export function generateLongEpisodeScript(projectId: string, episodeNumber: number, requestBody: GenerateLongEpisodeScriptRequest): Promise<GenerateLongEpisodeScriptResponse> { return request(API_ROUTES.longEpisodeScriptGeneration(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isEpisodeResponse); }
export function updateLongEpisodeScript(projectId: string, episodeNumber: number, requestBody: UpdateLongEpisodeScriptRequest): Promise<UpdateLongEpisodeScriptResponse> { return request(API_ROUTES.longEpisodeScript(projectId, episodeNumber), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isEpisodeResponse); }
export function approveLongEpisodeScript(projectId: string, episodeNumber: number, requestBody: ApproveLongEpisodeScriptRequest): Promise<ApproveLongEpisodeScriptResponse> { return request(API_ROUTES.longEpisodeScriptApproval(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isEpisodeResponse); }

export function getLongEpisodeAssetMappingReview(projectId: string, episodeNumber: number): Promise<GetLongEpisodeAssetMappingReviewResponse> {
  return request(API_ROUTES.longEpisodeAssetMappingReview(projectId, episodeNumber), undefined, isGetEpisodeMappingReviewResponse);
}

export function beginLongEpisodeAssetMappingReview(projectId: string, episodeNumber: number, requestBody: BeginLongEpisodeAssetMappingReviewRequest): Promise<BeginLongEpisodeAssetMappingReviewResponse> {
  return request(API_ROUTES.longEpisodeAssetMappingReview(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isBeginEpisodeMappingReviewResponse);
}

export function updateLongEpisodeAssetMapping(projectId: string, episodeNumber: number, mappingId: string, requestBody: UpdateLongEpisodeAssetMappingRequest): Promise<UpdateLongEpisodeAssetMappingResponse> {
  return request(API_ROUTES.longEpisodeAssetMapping(projectId, episodeNumber, mappingId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isUpdateEpisodeMappingResponse);
}

export function approveLongEpisodeAssetMappingReview(projectId: string, episodeNumber: number, requestBody: ApproveLongEpisodeAssetMappingReviewRequest): Promise<ApproveLongEpisodeAssetMappingReviewResponse> {
  return request(API_ROUTES.longEpisodeAssetMappingReviewApproval(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isApproveEpisodeMappingResponse);
}

/** Read-only deterministic scene-to-Asset preview; it never starts image generation. */
export function getLongEpisodeAutomaticReferenceSummary(projectId: string, episodeNumber: number): Promise<GetLongEpisodeAutomaticReferenceSummaryResponse> {
  return request(API_ROUTES.longEpisodeAutomaticReferenceSummary(projectId, episodeNumber), undefined, isGetAutomaticReferenceSummaryResponse);
}

/** Re-runs only the local matcher and returns the Episode to explicit mapping review. */
export function rerunLongEpisodeAssetMatching(projectId: string, episodeNumber: number): Promise<RerunLongEpisodeAssetMatchingResponse> {
  return request(API_ROUTES.longEpisodeAssetMatchingRerun(projectId, episodeNumber), { method: "POST" }, isRerunEpisodeAssetMatchingResponse);
}

export function getLongEpisodeImageReview(projectId: string, episodeNumber: number): Promise<GetLongEpisodeImageReviewResponse> {
  return request(API_ROUTES.longEpisodeImageReview(projectId, episodeNumber), undefined, isGetEpisodeImageReviewResponse);
}

export function startLongEpisodeImageGeneration(projectId: string, episodeNumber: number): Promise<StartLongEpisodeImageGenerationResponse> {
  const requestBody: StartLongEpisodeImageGenerationRequest = { approved: true };
  return request(API_ROUTES.longEpisodeImageGeneration(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isStartEpisodeImageGenerationResponse);
}

export function approveLongEpisodeImageReview(projectId: string, episodeNumber: number, sceneNumber: SceneNumber): Promise<ApproveLongEpisodeImageReviewResponse> {
  return request(API_ROUTES.longEpisodeImageReviewApproval(projectId, episodeNumber, sceneNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) }, isApproveEpisodeImageReviewResponse);
}

export function regenerateLongEpisodeImageReview(projectId: string, episodeNumber: number, sceneNumber: SceneNumber): Promise<RegenerateLongEpisodeImageReviewResponse> {
  return request(API_ROUTES.longEpisodeImageReviewRegeneration(projectId, episodeNumber, sceneNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) }, isRegenerateEpisodeImageReviewResponse);
}

export function getLongEpisodeVideoPreview(projectId: string, episodeNumber: number): Promise<GetLongEpisodeVideoPreviewResponse> { return request(API_ROUTES.longEpisodeVideoPreview(projectId, episodeNumber), undefined, isGetEpisodeVideoPreviewResponse); }
export function startLongEpisodeVideoGeneration(projectId: string, episodeNumber: number, requestBody: StartLongEpisodeVideoGenerationRequest): Promise<StartLongEpisodeVideoGenerationResponse> { return request(API_ROUTES.longEpisodeVideoGeneration(projectId, episodeNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isStartEpisodeVideoResponse); }
export function getLongEpisodeVideoProgress(projectId: string, episodeNumber: number, jobId: string): Promise<LongEpisodeVideoProgress> { return request(API_ROUTES.longEpisodeVideoProgress(projectId, episodeNumber, jobId), undefined, isEpisodeVideoProgress); }
export function stopLongEpisodeVideoGeneration(projectId: string, episodeNumber: number, jobId: string): Promise<LongEpisodeVideoProgress> { return request(API_ROUTES.longEpisodeVideoStop(projectId, episodeNumber, jobId), { method: "POST" }, isEpisodeVideoProgress); }
export function restartLongEpisodeVideoGeneration(projectId: string, episodeNumber: number, jobId: string): Promise<LongEpisodeVideoProgress> { return request(API_ROUTES.longEpisodeVideoRestart(projectId, episodeNumber, jobId), { method: "POST" }, isEpisodeVideoProgress); }
export function regenerateLongEpisodeVideo(projectId: string, episodeNumber: number, jobId: string, sceneNumber: SceneNumber): Promise<RegenerateLongEpisodeVideoResponse> { return request(API_ROUTES.longEpisodeVideoRegenerate(projectId, episodeNumber, jobId, sceneNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) }, isRegenerateEpisodeVideoResponse); }
export function getLongEpisodeVideoReview(projectId: string, episodeNumber: number, jobId: string): Promise<GetLongEpisodeVideoReviewResponse> { return request(API_ROUTES.longEpisodeVideoReview(projectId, episodeNumber, jobId), undefined, isGetEpisodeVideoReviewResponse); }
export function approveLongEpisodeVideoReview(projectId: string, episodeNumber: number, jobId: string, sceneNumber: SceneNumber): Promise<ApproveLongEpisodeVideoReviewResponse> { return request(API_ROUTES.longEpisodeVideoReviewApproval(projectId, episodeNumber, jobId, sceneNumber), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) }, isApproveEpisodeVideoReviewResponse); }
/** Sends only the already explicitly confirmed Episode final-render request. */
export function mergeLongEpisodeVideos(projectId: string, episodeNumber: number): Promise<MergeLongEpisodeVideosResponse> { return request(API_ROUTES.longEpisodeVideoMerge(projectId, episodeNumber), { method: "POST" }, isMergeLongEpisodeVideosResponse); }
export function getLongEpisodeContinuity(projectId: string, episodeNumber: number): Promise<GetLongEpisodeContinuityResponse> { return request(API_ROUTES.longEpisodeContinuity(projectId, episodeNumber), undefined, isGetLongEpisodeContinuityResponse); }
export function saveLongEpisodeContinuity(projectId: string, episodeNumber: number, requestBody: SaveLongEpisodeContinuityRequest): Promise<SaveLongEpisodeContinuityResponse> { return request(API_ROUTES.longEpisodeContinuity(projectId, episodeNumber), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, isSaveLongEpisodeContinuityResponse); }
export function getLongEpisodeContinuityReference(projectId: string, episodeNumber: number): Promise<GetLongEpisodeContinuityReferenceResponse> { return request(API_ROUTES.longEpisodeContinuityReference(projectId, episodeNumber), undefined, isGetLongEpisodeContinuityReferenceResponse); }
