import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type VideoSubmissionErrorCode =
  | "INVALID_REQUEST"
  | "VIDEO_SUBMISSION_NOT_ALLOWED"
  | "VIDEO_CONFIRMATION_STALE"
  | "VIDEO_REQUEST_ID_CONFLICT"
  | "VIDEO_BUDGET_EXCEEDED"
  | "VIDEO_CALL_LIMIT_EXCEEDED";

class VideoSubmissionApiException extends HttpException {
  constructor(code: VideoSubmissionErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
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
