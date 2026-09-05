import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";
import { BUDGET_LEDGER_UNREADABLE_CODE, BUDGET_LEDGER_UNREADABLE_MESSAGE } from "../providers/budget-ledger.js";

type Code = "INVALID_REQUEST" | "UNSAFE_PROJECT_ID" | "LONG_PROJECT_NOT_FOUND" | "LONG_PROJECT_ALREADY_EXISTS" | "LONG_PROJECT_JSON_MALFORMED" | "LONG_PROJECT_DATA_INVALID" | "LONG_PROJECT_STORAGE_ERROR" | "LONG_PROJECT_ARCHIVE_NOT_ALLOWED" | "LONG_PROJECT_ASPECT_RATIO_LOCKED" | "LONG_PROJECT_EPISODE_COUNT_LOCKED" | "LONG_PROJECT_ARCHIVE_COLLISION" | "LONG_PROJECT_RESTORE_COLLISION" | "LONG_OUTLINE_STALE" | "LONG_OUTLINE_NOT_ALLOWED" | "LONG_OUTLINE_BUDGET_EXCEEDED" | "LONG_OUTLINE_PROVIDER_ERROR" | "LONG_EPISODE_NOT_FOUND" | "LONG_EPISODE_TIMELINE_NOT_ALLOWED" | "LONG_EPISODE_LIMIT_REACHED" | "LONG_EPISODE_SCRIPT_NOT_ALLOWED" | "LONG_EPISODE_SCRIPT_EXISTS" | "LONG_EPISODE_SETTINGS_NOT_ALLOWED" | "LONG_EPISODE_SCRIPT_BUDGET_EXCEEDED" | "LONG_EPISODE_SCRIPT_PROVIDER_ERROR" | "LONG_EPISODE_MAPPING_NOT_ALLOWED" | "LONG_EPISODE_MAPPING_NOT_FOUND" | "LONG_EPISODE_MAPPING_STALE" | "LONG_EPISODE_MAPPING_UNCONFIRMED" | "LONG_EPISODE_IMAGES_NOT_ALLOWED" | "LONG_EPISODE_IMAGES_INVALID" | "LONG_EPISODE_IMAGES_BUDGET_EXCEEDED" | "LONG_EPISODE_IMAGES_PROVIDER_ERROR" | "LONG_EPISODE_VIDEOS_NOT_ALLOWED" | "LONG_EPISODE_VIDEOS_INVALID" | "LONG_EPISODE_VIDEO_JOB_NOT_FOUND" | "LONG_EPISODE_VIDEO_VERSION_NOT_FOUND" | "LONG_EPISODE_VIDEO_RESTORE_NOT_ALLOWED" | "LONG_EPISODE_MERGE_NOT_ALLOWED" | "LONG_EPISODE_MERGE_ALREADY_COMPLETED" | "LONG_EPISODE_MERGE_BUSY" | "AUDIO_START_OUT_OF_RANGE" | "LONG_EPISODE_MERGE_CLIPS_INVALID" | "LONG_EPISODE_FFMPEG_UNAVAILABLE" | "LONG_EPISODE_MERGE_FAILED" | "LONG_EPISODE_CONTINUITY_NOT_ALLOWED" | "LONG_EPISODE_NARRATION_NOT_ALLOWED" | "LONG_EPISODE_NARRATION_NOT_ENABLED" | "LONG_EPISODE_NARRATION_MISSING_TEXT" | "LONG_EPISODE_NARRATION_GENERATION_FAILED" | "LONG_EPISODE_NARRATION_STORAGE_ERROR" | "LONG_EPISODE_NARRATION_BUDGET_EXCEEDED" | "LONG_EPISODE_NARRATION_PROVIDER_ERROR" | "LONG_EPISODE_NARRATION_CONTENT_UNAVAILABLE" | "STORY_BIBLE_ITEM_NOT_FOUND" | "STORY_BIBLE_ITEM_ALREADY_EXISTS" | "PROJECT_LOCKED" | "BUDGET_LEDGER_UNREADABLE";

export class LongProjectApiException extends HttpException {
  constructor(code: Code, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    super((details ? { code, message, details } : { code, message }) satisfies ApiError, status);
  }
}
/**
 * Whether this error is one of the named codes.
 *
 * For the few callers that must survive a specific failure rather than propagate it — reading an optional file
 * that may be absent or unreadable, say. Matching on the code rather than the HTTP status because several
 * distinct failures share a status: LONG_PROJECT_JSON_MALFORMED and LONG_PROJECT_STORAGE_ERROR are both 500,
 * and only one of them means "there is nothing here to read".
 */
export function isLongProjectError(error: unknown, ...codes: Code[]): boolean {
  if (!(error instanceof LongProjectApiException)) return false;
  const body = error.getResponse();
  return typeof body === "object" && body !== null && codes.includes((body as { code: Code }).code);
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
/** Same code and meaning as the short project's audioStartOutOfRange, length included: one sentence serves both screens. */
export const longAudioStartOutOfRange = (durationSeconds: number) => new LongProjectApiException("AUDIO_START_OUT_OF_RANGE", "The chosen music start is past the end of the track.", HttpStatus.BAD_REQUEST, { durationSeconds });
/** Same meaning as the short project's videoMergeBusy: something else holds this Episode's final video right now, nothing was rendered, and waiting is the whole fix. */
export const longEpisodeMergeBusy = () => new LongProjectApiException("LONG_EPISODE_MERGE_BUSY", "This Episode's final video is busy - another window is publishing or rendering it.", HttpStatus.CONFLICT);
/** Same reasoning as the short project's videoMergeAlreadyCompleted: a completed Episode has every scene approved, so the approval sentence names a cause that is not the cause. */
export const longEpisodeMergeAlreadyCompleted = () => new LongProjectApiException("LONG_EPISODE_MERGE_ALREADY_COMPLETED", "This Episode's final video has already been rendered.", HttpStatus.CONFLICT);
export const longEpisodeMergeNotAllowed = () => new LongProjectApiException("LONG_EPISODE_MERGE_NOT_ALLOWED", "Final rendering requires every Episode scene video to be approved.", HttpStatus.CONFLICT);
export const longEpisodeVideoVersionNotFound = () => new LongProjectApiException("LONG_EPISODE_VIDEO_VERSION_NOT_FOUND", "That saved copy of the Episode scene video was not found.", HttpStatus.NOT_FOUND);
export const longEpisodeVideoRestoreNotAllowed = () => new LongProjectApiException("LONG_EPISODE_VIDEO_RESTORE_NOT_ALLOWED", "The clip already in use cannot be restored over itself.", HttpStatus.CONFLICT);
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
 * unhandled exception. Every guarded step raises this one `code`, which it also shares with
 * video-workflow-api.error.ts's short-project twin, so the frontend needs a single safe-message table entry for
 * all of them (docs/06_DECISIONS.md D-010).
 *
 * `subject` names the work that is already running, and reaches logs rather than the screen — the frontend
 * answers the code, not the message. One factory taking the subject rather than one per guarded step: they
 * would differ only in that string, and a family of near-identical factories invites the next step to add a
 * fifth instead of asking whether its refusal is really different.
 */
/**
 * The spend ledger could not be read, so no paid request is sent.
 *
 * Distinct from a storage error on purpose: that one can pass, this one cannot until a file is repaired, and
 * the screen's sentence for it says exactly that. Sending the generic code instead sent the person back to
 * press a button that was certain to refuse again (docs/06_DECISIONS.md D-036).
 */
export const longBudgetLedgerUnreadable = () =>
  new LongProjectApiException(BUDGET_LEDGER_UNREADABLE_CODE, BUDGET_LEDGER_UNREADABLE_MESSAGE, HttpStatus.CONFLICT);
export const longLocked = (subject: string) => new LongProjectApiException("PROJECT_LOCKED", `${subject} is already in progress for this Long Project.`, HttpStatus.CONFLICT);

/**
 * The Episode's own scene count and clip length can no longer be changed, because a script has been written for
 * them. Regenerating the script is the way to change them — a paid step, chosen on purpose, rather than
 * something a settings save does behind the person's back.
 */
export const longEpisodeSettingsNotAllowed = () => new LongProjectApiException("LONG_EPISODE_SETTINGS_NOT_ALLOWED", "This Episode already has a script written for its current scene count and clip length.", HttpStatus.CONFLICT);

/**
 * The aspect ratio cannot be changed once an Episode has images made at the current one.
 *
 * Images, video generation and the merge each read the project's ratio when they run, not when the work started.
 * Changing it midway means portrait images are sent to Runway asking for landscape video, and the merge then
 * pads whatever comes back to the new shape — paid work, produced at a size nothing else in the project matches.
 * A project generated, billed and merged in the wrong orientation is a mistake this repository has already made
 * once (see the commit that restored it), and this is the version of it that a settings save can cause.
 *
 * The Episode number travels in `details` as well as the message: the message is the backend's own words and
 * never reaches a screen, so a frontend that wants to name the Episode has nowhere else to get it. Same shape
 * as the short side's PROJECT_SCENE_COUNT_LOCKED.
 */
export const longAspectRatioLocked = (episodeNumber: number) => new LongProjectApiException("LONG_PROJECT_ASPECT_RATIO_LOCKED", `Episode ${episodeNumber} already has images made at the current aspect ratio.`, HttpStatus.CONFLICT, { episodeNumber });

/**
 * The episode count cannot be reduced past an Episode that has been worked on.
 *
 * Dropping it from the outline list would leave its script, images and videos on disk with nothing pointing at
 * them — work that was paid for, gone from the app with no way back to it. Refusing says which Episode is in
 * the way while the person is still looking at the number they typed. The number travels in `details` too,
 * for the same reason as LONG_PROJECT_ASPECT_RATIO_LOCKED above.
 */
export const longEpisodeCountLocked = (episodeNumber: number) => new LongProjectApiException("LONG_PROJECT_EPISODE_COUNT_LOCKED", `Episode ${episodeNumber} has already been worked on and would be dropped.`, HttpStatus.CONFLICT, { episodeNumber });
