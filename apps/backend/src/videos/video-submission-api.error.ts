import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type VideoSubmissionErrorCode =
  | "INVALID_REQUEST"
  | "VIDEO_SUBMISSION_NOT_ALLOWED"
  | "VIDEO_CONFIRMATION_STALE"
  | "VIDEO_REQUEST_ID_CONFLICT"
  | "VIDEO_BUDGET_EXCEEDED"
  | "VIDEO_CALL_LIMIT_EXCEEDED"
  | "VIDEO_CLIP_DURATION_OUT_OF_RANGE";

class VideoSubmissionApiException extends HttpException {
  constructor(code: VideoSubmissionErrorCode, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    const body: ApiError = { code, message, ...(details ? { details } : {}) };
    super(body, status);
  }
}

export const invalidVideoSubmission = () =>
  new VideoSubmissionApiException("INVALID_REQUEST", "Video submission requires one explicit, valid confirmation request.", HttpStatus.BAD_REQUEST);
export const videoSubmissionNotAllowed = () =>
  new VideoSubmissionApiException("VIDEO_SUBMISSION_NOT_ALLOWED", "Video submission requires six approved images and video confirmation state.", HttpStatus.CONFLICT);
export const videoConfirmationStale = () =>
  new VideoSubmissionApiException("VIDEO_CONFIRMATION_STALE", "The video preflight has changed. Review the current prompts and cost again.", HttpStatus.CONFLICT);
export const videoRequestIdConflict = () =>
  new VideoSubmissionApiException("VIDEO_REQUEST_ID_CONFLICT", "This request ID was already used with different video inputs.", HttpStatus.CONFLICT);
export const videoBudgetExceeded = () =>
  new VideoSubmissionApiException("VIDEO_BUDGET_EXCEEDED", "The local Runway budget does not cover this confirmed request.", HttpStatus.CONFLICT);
export const videoCallLimitExceeded = () =>
  new VideoSubmissionApiException("VIDEO_CALL_LIMIT_EXCEEDED", "The confirmed request exceeds the allowed provider call count.", HttpStatus.CONFLICT);

/**
 * The scene length is outside the range the job's model makes (VideoModelOption.minDurationSeconds/maxDurationSeconds).
 * Refused before any job record is written — the adapter would refuse every scene anyway, leaving a job of failures.
 */
export const videoClipDurationOutOfRange = (details: { model: string; durationSeconds: number; minDurationSeconds: number; maxDurationSeconds: number }) =>
  new VideoSubmissionApiException("VIDEO_CLIP_DURATION_OUT_OF_RANGE", `The ${details.model} model makes clips of ${details.minDurationSeconds}-${details.maxDurationSeconds} seconds, not ${details.durationSeconds}.`, HttpStatus.CONFLICT, details);
