import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type Code = "INVALID_REQUEST" | "UNSAFE_PROJECT_ID" | "LONG_PROJECT_NOT_FOUND" | "LONG_PROJECT_ALREADY_EXISTS" | "LONG_PROJECT_JSON_MALFORMED" | "LONG_PROJECT_DATA_INVALID" | "LONG_PROJECT_STORAGE_ERROR" | "LONG_PROJECT_ARCHIVE_NOT_ALLOWED" | "LONG_PROJECT_ARCHIVE_COLLISION" | "LONG_PROJECT_RESTORE_COLLISION" | "LONG_OUTLINE_STALE" | "LONG_OUTLINE_NOT_ALLOWED" | "LONG_OUTLINE_BUDGET_EXCEEDED" | "LONG_OUTLINE_PROVIDER_ERROR" | "LONG_EPISODE_NOT_FOUND" | "LONG_EPISODE_TIMELINE_NOT_ALLOWED" | "LONG_EPISODE_LIMIT_REACHED" | "LONG_EPISODE_SCRIPT_NOT_ALLOWED" | "LONG_EPISODE_SCRIPT_EXISTS" | "LONG_EPISODE_SCRIPT_BUDGET_EXCEEDED" | "LONG_EPISODE_SCRIPT_PROVIDER_ERROR" | "LONG_EPISODE_MAPPING_NOT_ALLOWED" | "LONG_EPISODE_MAPPING_NOT_FOUND" | "LONG_EPISODE_MAPPING_STALE" | "LONG_EPISODE_MAPPING_UNCONFIRMED" | "LONG_EPISODE_IMAGES_NOT_ALLOWED" | "LONG_EPISODE_IMAGES_INVALID" | "LONG_EPISODE_IMAGES_BUDGET_EXCEEDED" | "LONG_EPISODE_IMAGES_PROVIDER_ERROR" | "LONG_EPISODE_VIDEOS_NOT_ALLOWED" | "LONG_EPISODE_VIDEOS_INVALID" | "LONG_EPISODE_VIDEO_JOB_NOT_FOUND" | "LONG_EPISODE_MERGE_NOT_ALLOWED" | "LONG_EPISODE_MERGE_CLIPS_INVALID" | "LONG_EPISODE_FFMPEG_UNAVAILABLE" | "LONG_EPISODE_MERGE_FAILED" | "LONG_EPISODE_CONTINUITY_NOT_ALLOWED" | "LONG_EPISODE_NARRATION_NOT_ALLOWED" | "LONG_EPISODE_NARRATION_NOT_ENABLED" | "LONG_EPISODE_NARRATION_MISSING_TEXT" | "LONG_EPISODE_NARRATION_GENERATION_FAILED" | "LONG_EPISODE_NARRATION_STORAGE_ERROR" | "LONG_EPISODE_NARRATION_BUDGET_EXCEEDED" | "LONG_EPISODE_NARRATION_PROVIDER_ERROR" | "LONG_EPISODE_NARRATION_CONTENT_UNAVAILABLE" | "STORY_BIBLE_ITEM_NOT_FOUND" | "STORY_BIBLE_ITEM_ALREADY_EXISTS" | "PROJECT_LOCKED";

export class LongProjectApiException extends HttpException {
  constructor(code: Code, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    super((details ? { code, message, details } : { code, message }) satisfies ApiError, status);
  }
}
export const longInvalidRequest = (message = "Long project request is invalid.") => new LongProjectApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST);
export const longUnsafeId = () => new LongProjectApiException("UNSAFE_PROJECT_ID", "Project ID must contain only letters, numbers, '_' or '-'.", HttpStatus.BAD_REQUEST);
export const longNotFound = () => new LongProjectApiException("LONG_PROJECT_NOT_FOUND", "Long project was not found.", HttpStatus.NOT_FOUND);
export const longExists = () => new LongProjectApiException("LONG_PROJECT_ALREADY_EXISTS", "Long project already exists.", HttpStatus.CONFLICT);
export const longMalformed = () => new LongProjectApiException("LONG_PROJECT_JSON_MALFORMED", "Long project data is not valid JSON.", HttpStatus.INTERNAL_SERVER_ERROR);
export const longInvalidData = () => new LongProjectApiException("LONG_PROJECT_DATA_INVALID", "Long project data is invalid.", HttpStatus.INTERNAL_SERVER_ERROR);
export const longStorageError = () => new LongProjectApiException("LONG_PROJECT_STORAGE_ERROR", "Long project storage could not be read or written.", HttpStatus.INTERNAL_SERVER_ERROR);
export const longArchiveNotAllowed = () => new LongProjectApiException("LONG_PROJECT_ARCHIVE_NOT_ALLOWED", "A long project with active generation or rendering work cannot be archived.", HttpStatus.CONFLICT);
export const longArchiveCollision = () => new LongProjectApiException("LONG_PROJECT_ARCHIVE_COLLISION", "A recoverable archive already exists for this long project.", HttpStatus.CONFLICT);
export const longRestoreCollision = () => new LongProjectApiException("LONG_PROJECT_RESTORE_COLLISION", "An active long project already exists at this project's original location.", HttpStatus.CONFLICT);
export const longOutlineStale = () => new LongProjectApiException("LONG_OUTLINE_STALE", "The outline prompt is stale. Preview it again before approval.", HttpStatus.CONFLICT);
export const longOutlineNotAllowed = () => new LongProjectApiException("LONG_OUTLINE_NOT_ALLOWED", "Outline approval requires a planned long project.", HttpStatus.CONFLICT);
export const longOutlineBudgetExceeded = (message: string) => new LongProjectApiException("LONG_OUTLINE_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const longOutlineProviderError = (category: string, message: string) => new LongProjectApiException("LONG_OUTLINE_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, { category });
export const longEpisodeNotFound = () => new LongProjectApiException("LONG_EPISODE_NOT_FOUND", "Long project episode was not found.", HttpStatus.NOT_FOUND);
export const longEpisodeTimelineNotAllowed = () => new LongProjectApiException("LONG_EPISODE_TIMELINE_NOT_ALLOWED", "Timeline edits require draft-only Episodes and may archive only the final Episode.", HttpStatus.CONFLICT);
export const longEpisodeLimitReached = () => new LongProjectApiException("LONG_EPISODE_LIMIT_REACHED", "The configured long-project Episode limit has been reached.", HttpStatus.CONFLICT);
export const longEpisodeScriptNotAllowed = () => new LongProjectApiException("LONG_EPISODE_SCRIPT_NOT_ALLOWED", "Episode script is not allowed in the current state.", HttpStatus.CONFLICT);
export const longEpisodeScriptExists = () => new LongProjectApiException("LONG_EPISODE_SCRIPT_EXISTS", "Episode script already exists; explicit regeneration is required.", HttpStatus.CONFLICT);
export const longEpisodeScriptBudgetExceeded = (message: string) => new LongProjectApiException("LONG_EPISODE_SCRIPT_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const longEpisodeScriptProviderError = (category: string, message: string) => new LongProjectApiException("LONG_EPISODE_SCRIPT_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, { category });
export const longEpisodeMappingNotAllowed = () => new LongProjectApiException("LONG_EPISODE_MAPPING_NOT_ALLOWED", "Episode Asset Mapping review is not allowed in the current state.", HttpStatus.CONFLICT);
export const longEpisodeMappingNotFound = () => new LongProjectApiException("LONG_EPISODE_MAPPING_NOT_FOUND", "Episode Asset Mapping was not found.", HttpStatus.NOT_FOUND);
export const longEpisodeMappingStale = () => new LongProjectApiException("LONG_EPISODE_MAPPING_STALE", "Episode Asset Mapping review is stale. Start the review again.", HttpStatus.CONFLICT);
export const longEpisodeMappingUnconfirmed = () => new LongProjectApiException("LONG_EPISODE_MAPPING_UNCONFIRMED", "Confirm or exclude every Episode Asset Mapping candidate before approval.", HttpStatus.CONFLICT);
export const longEpisodeImagesNotAllowed = () => new LongProjectApiException("LONG_EPISODE_IMAGES_NOT_ALLOWED", "Episode image work is not allowed in the current state.", HttpStatus.CONFLICT);
export const longEpisodeImagesInvalid = () => new LongProjectApiException("LONG_EPISODE_IMAGES_INVALID", "Episode images or their review data are invalid.", HttpStatus.CONFLICT);
export const longEpisodeImagesBudgetExceeded = (message: string) => new LongProjectApiException("LONG_EPISODE_IMAGES_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const longEpisodeImagesProviderError = (category: string, message: string) => new LongProjectApiException("LONG_EPISODE_IMAGES_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, { category });
export const longEpisodeVideosNotAllowed = () => new LongProjectApiException("LONG_EPISODE_VIDEOS_NOT_ALLOWED", "Episode video work is not allowed in the current state.", HttpStatus.CONFLICT);
export const longEpisodeVideosInvalid = () => new LongProjectApiException("LONG_EPISODE_VIDEOS_INVALID", "Episode videos or their review data are invalid.", HttpStatus.CONFLICT);
export const longEpisodeVideoJobNotFound = () => new LongProjectApiException("LONG_EPISODE_VIDEO_JOB_NOT_FOUND", "Episode video job was not found.", HttpStatus.NOT_FOUND);
export const longEpisodeMergeNotAllowed = () => new LongProjectApiException("LONG_EPISODE_MERGE_NOT_ALLOWED", "Final rendering requires every Episode scene video to be approved.", HttpStatus.CONFLICT);
export const longEpisodeMergeClipsInvalid = () => new LongProjectApiException("LONG_EPISODE_MERGE_CLIPS_INVALID", "The approved Episode scene videos are missing or invalid.", HttpStatus.CONFLICT);
export const longEpisodeFfmpegUnavailable = () => new LongProjectApiException("LONG_EPISODE_FFMPEG_UNAVAILABLE", "FFmpeg or ffprobe is not available on this computer.", HttpStatus.SERVICE_UNAVAILABLE);
export const longEpisodeMergeFailed = () => new LongProjectApiException("LONG_EPISODE_MERGE_FAILED", "Episode rendering failed. Approved scene videos were kept.", HttpStatus.INTERNAL_SERVER_ERROR);
export const longEpisodeContinuityNotAllowed = () => new LongProjectApiException("LONG_EPISODE_CONTINUITY_NOT_ALLOWED", "Episode Continuity Memory can be saved only after image approval.", HttpStatus.CONFLICT);
export const longEpisodeNarrationNotAllowed = () => new LongProjectApiException("LONG_EPISODE_NARRATION_NOT_ALLOWED", "Episode narration work requires the Episode to already have a script.", HttpStatus.CONFLICT);
export const longEpisodeNarrationNotEnabled = () => new LongProjectApiException("LONG_EPISODE_NARRATION_NOT_ENABLED", "narrationEnabled must be on in project settings before narration audio can be generated.", HttpStatus.CONFLICT);
export const longEpisodeNarrationMissingText = () => new LongProjectApiException("LONG_EPISODE_NARRATION_MISSING_TEXT", "This scene has no narration text to synthesize.", HttpStatus.CONFLICT);
export const longEpisodeNarrationGenerationFailed = () => new LongProjectApiException("LONG_EPISODE_NARRATION_GENERATION_FAILED", "Narration audio generation did not produce a valid file.", HttpStatus.INTERNAL_SERVER_ERROR);
export const longEpisodeNarrationStorageError = () => new LongProjectApiException("LONG_EPISODE_NARRATION_STORAGE_ERROR", "Episode narration generation storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR);
export const longEpisodeNarrationBudgetExceeded = (message: string) => new LongProjectApiException("LONG_EPISODE_NARRATION_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const longEpisodeNarrationProviderError = (category: string, message: string) => new LongProjectApiException("LONG_EPISODE_NARRATION_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, { category });
export const longEpisodeNarrationContentUnavailable = () => new LongProjectApiException("LONG_EPISODE_NARRATION_CONTENT_UNAVAILABLE", "The requested scene narration audio is unavailable.", HttpStatus.NOT_FOUND);
export const storyBibleItemNotFound = () => new LongProjectApiException("STORY_BIBLE_ITEM_NOT_FOUND", "Story Bible item was not found.", HttpStatus.NOT_FOUND);
export const storyBibleItemExists = () => new LongProjectApiException("STORY_BIBLE_ITEM_ALREADY_EXISTS", "Story Bible item already exists.", HttpStatus.CONFLICT);
/**
 * project-lock.ts's ProjectLockTimeoutError, mapped to a proper API error instead of falling through as an
 * unhandled exception — see episode-videos.service.ts's advanceReal() call site and
 * video-workflow-api.error.ts's videoWorkflowLocked() for the short-project twin this shares its literal `code`
 * value with, so the frontend needs only one safe-message table entry for both (docs/06_DECISIONS.md D-010).
 */
export const longEpisodeLocked = () => new LongProjectApiException("PROJECT_LOCKED", "Another process is currently advancing this Episode's video generation.", HttpStatus.CONFLICT);
