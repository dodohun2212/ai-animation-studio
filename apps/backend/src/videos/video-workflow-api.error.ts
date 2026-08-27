import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type VideoWorkflowErrorCode =
  | "INVALID_REQUEST"
  | "VIDEO_JOB_NOT_FOUND"
  | "VIDEO_WORKFLOW_NOT_ALLOWED"
  | "VIDEO_REVIEW_DATA_INVALID"
  | "VIDEO_STORAGE_ERROR"
  | "VIDEO_CONTENT_UNAVAILABLE"
  | "PROJECT_LOCKED";

class VideoWorkflowApiException extends HttpException {
  constructor(code: VideoWorkflowErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
    super(body, status);
  }
}

export const invalidVideoWorkflowRequest = () =>
  new VideoWorkflowApiException("INVALID_REQUEST", "This video operation requires explicit approval.", HttpStatus.BAD_REQUEST);
export const videoJobNotFound = () =>
  new VideoWorkflowApiException("VIDEO_JOB_NOT_FOUND", "The requested local video job was not found.", HttpStatus.NOT_FOUND);
export const videoWorkflowNotAllowed = () =>
  new VideoWorkflowApiException("VIDEO_WORKFLOW_NOT_ALLOWED", "This video operation is not allowed in the current project state.", HttpStatus.CONFLICT);
export const videoReviewDataInvalid = () =>
  new VideoWorkflowApiException("VIDEO_REVIEW_DATA_INVALID", "Generated video review data is invalid.", HttpStatus.INTERNAL_SERVER_ERROR);
export const videoStorageError = () =>
  new VideoWorkflowApiException("VIDEO_STORAGE_ERROR", "Local video workflow storage failed.", HttpStatus.INTERNAL_SERVER_ERROR);
export const videoContentUnavailable = () =>
  new VideoWorkflowApiException("VIDEO_CONTENT_UNAVAILABLE", "The requested scene video is unavailable.", HttpStatus.NOT_FOUND);
/**
 * project-lock.ts's ProjectLockTimeoutError, mapped to a proper API error instead of falling through as an
 * unhandled exception (a generic 500 with no `code`, read by the frontend as a malformed response) — see
 * local-video-workflow.service.ts's advanceReal() call site. Shares its literal `code` value with
 * long-project-api.error.ts's own factory for the same condition, so the frontend needs only one safe-message
 * table entry for both short and Long Episode video generation (docs/06_DECISIONS.md D-010).
 */
export const videoWorkflowLocked = () =>
  new VideoWorkflowApiException("PROJECT_LOCKED", "Another process is currently advancing this project's video generation.", HttpStatus.CONFLICT);
