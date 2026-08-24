import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type VideoMergeErrorCode =
  | "VIDEO_MERGE_NOT_ALLOWED"
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

export const videoMergeNotAllowed = () =>
  new VideoMergeApiException("VIDEO_MERGE_NOT_ALLOWED", "Final rendering requires six approved scene videos.", HttpStatus.CONFLICT);
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
