import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type VideoMergeErrorCode =
  | "INVALID_REQUEST"
  | "VIDEO_MERGE_NOT_ALLOWED"
  | "VIDEO_MERGE_ALREADY_COMPLETED"
  | "VIDEO_MERGE_ALREADY_PUBLISHED"
  | "VIDEO_MERGE_BUSY"
  | "VIDEO_MERGE_CLIPS_INVALID"
  | "FFMPEG_UNAVAILABLE"
  | "VIDEO_MERGE_FAILED"
  | "VIDEO_STORAGE_ERROR"
  | "VIDEO_MERGE_CONTENT_UNAVAILABLE";

class VideoMergeApiException extends HttpException {
  constructor(code: VideoMergeErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
    super(body, status);
  }
}

export const videoMergeInvalidRequest = (message = "Request is invalid.") =>
  new VideoMergeApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST);
export const videoMergeNotAllowed = () =>
  new VideoMergeApiException("VIDEO_MERGE_NOT_ALLOWED", "Final rendering requires six approved scene videos.", HttpStatus.CONFLICT);
/**
 * Distinct from `videoMergeNotAllowed` because the two states are opposites and one message cannot honestly
 * serve both. A completed project has every scene approved — telling that person "approval is required" names
 * a cause that is not the cause and points them at work they already finished. Measured: merging twice returned
 * exactly that sentence.
 */
export const videoMergeAlreadyCompleted = () =>
  new VideoMergeApiException("VIDEO_MERGE_ALREADY_COMPLETED", "This project's final video has already been rendered.", HttpStatus.CONFLICT);
/**
 * A photo card that has already been posted to Instagram.
 *
 * Every other completed card may be made again — a card costs nothing to render and its previous final video is
 * archived first, so "already done" was protecting nothing while it locked the person out of their own text
 * (Cowork Round 440). A published one is the exception: the file the post was made from would quietly stop
 * being the file on disk, and nothing on either side would say the two had diverged.
 *
 * Its own code, not the "already rendered" one, because the two send the person to different places: this one
 * is about a post that exists, and the way past it is a new card rather than a retry.
 */
export const videoMergeAlreadyPublished = () =>
  new VideoMergeApiException("VIDEO_MERGE_ALREADY_PUBLISHED", "This photo card has already been published to Instagram.", HttpStatus.CONFLICT);
/**
 * Another operation is holding this project's final video — a publish reading it, a version being restored, or
 * a merge already running in another window.
 *
 * Says "wait", and means it: nothing was rendered and nothing was changed, so pressing again once the other
 * one finishes is the whole fix. Kept apart from the storage error, which means the opposite thing (something
 * failed and may not succeed on a retry).
 */
export const videoMergeBusy = () =>
  new VideoMergeApiException("VIDEO_MERGE_BUSY", "This project's final video is busy — another window is publishing or rendering it.", HttpStatus.CONFLICT);
export const videoMergeClipsInvalid = () =>
  new VideoMergeApiException("VIDEO_MERGE_CLIPS_INVALID", "The six approved scene videos are missing or invalid.", HttpStatus.CONFLICT);
export const ffmpegUnavailable = () =>
  new VideoMergeApiException("FFMPEG_UNAVAILABLE", "FFmpeg or ffprobe is not available on this computer.", HttpStatus.SERVICE_UNAVAILABLE);
export const videoMergeFailed = () =>
  new VideoMergeApiException("VIDEO_MERGE_FAILED", "Local video rendering failed. Approved scene videos were kept.", HttpStatus.INTERNAL_SERVER_ERROR);
export const videoMergeStorageError = () =>
  new VideoMergeApiException("VIDEO_STORAGE_ERROR", "Local video render state could not be saved.", HttpStatus.INTERNAL_SERVER_ERROR);
export const videoMergeContentUnavailable = () =>
  new VideoMergeApiException("VIDEO_MERGE_CONTENT_UNAVAILABLE", "The final merged video is unavailable.", HttpStatus.NOT_FOUND);
