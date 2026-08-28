import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type NarrationErrorCode =
  | "INVALID_REQUEST"
  | "NARRATION_NOT_ENABLED"
  | "NARRATION_MISSING_TEXT"
  | "NARRATION_GENERATION_FAILED"
  | "NARRATION_STORAGE_ERROR"
  | "NARRATION_BUDGET_EXCEEDED"
  | "NARRATION_PROVIDER_ERROR"
  | "NARRATION_CONTENT_UNAVAILABLE"
  | "PROJECT_LOCKED";

class NarrationApiException extends HttpException {
  constructor(code: NarrationErrorCode, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    const body: ApiError = details ? { code, message, details } : { code, message };
    super(body, status);
  }
}

export const invalidNarrationRequest = () =>
  new NarrationApiException("INVALID_REQUEST", "Narration generation requires explicit approval.", HttpStatus.BAD_REQUEST);
export const narrationNotEnabled = () =>
  new NarrationApiException("NARRATION_NOT_ENABLED", "narrationEnabled must be on in project settings before narration audio can be generated.", HttpStatus.CONFLICT);
export const narrationMissingText = () =>
  new NarrationApiException("NARRATION_MISSING_TEXT", "This scene has no narration text to synthesize.", HttpStatus.CONFLICT);
export const narrationGenerationFailed = () =>
  new NarrationApiException("NARRATION_GENERATION_FAILED", "Narration audio generation did not produce a valid file.", HttpStatus.INTERNAL_SERVER_ERROR);
export const narrationStorageError = () =>
  new NarrationApiException("NARRATION_STORAGE_ERROR", "Narration generation storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR);
export const narrationBudgetExceeded = (message: string) =>
  new NarrationApiException("NARRATION_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const narrationProviderError = (category: string, message: string) =>
  new NarrationApiException("NARRATION_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, { category });
export const narrationContentUnavailable = () =>
  new NarrationApiException("NARRATION_CONTENT_UNAVAILABLE", "The requested scene narration audio is unavailable.", HttpStatus.NOT_FOUND);

/**
 * project-lock.ts's ProjectLockTimeoutError as an API error. Shares its literal `code` with the Long Project and
 * video-workflow twins, so the frontend answers all of them from one safe-message entry (docs/06_DECISIONS.md
 * D-010), and names no subject for the same reason it is shared.
 */
export const narrationLocked = () =>
  new NarrationApiException("PROJECT_LOCKED", "Narration audio is already being generated for this project.", HttpStatus.CONFLICT);
