import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type ImageErrorCode = "INVALID_REQUEST" | "IMAGE_GENERATION_NOT_ALLOWED" | "ASSET_MAPPING_REVIEW_REQUIRED" | "IMAGE_GENERATION_FAILED" | "IMAGE_STORAGE_ERROR" | "IMAGE_BUDGET_EXCEEDED" | "IMAGE_PROVIDER_ERROR" | "IMAGE_CONTENT_UNAVAILABLE" | "BUDGET_LEDGER_UNREADABLE";

class ImageApiException extends HttpException {
  constructor(code: ImageErrorCode, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    const body: ApiError = details ? { code, message, details } : { code, message };
    super(body, status);
  }
}

export const invalidImageRequest = () =>
  new ImageApiException("INVALID_REQUEST", "Image generation requires explicit approval.", HttpStatus.BAD_REQUEST);
export const imageGenerationNotAllowed = () =>
  new ImageApiException("IMAGE_GENERATION_NOT_ALLOWED", "Image generation requires an Asset-Mapping-approved project.", HttpStatus.CONFLICT);
export const mappingReviewRequired = () =>
  new ImageApiException("ASSET_MAPPING_REVIEW_REQUIRED", "A current approved Asset Mapping review is required before image generation.", HttpStatus.CONFLICT);
export const imageGenerationFailed = () =>
  new ImageApiException("IMAGE_GENERATION_FAILED", "Local image generation did not produce six valid PNG files.", HttpStatus.INTERNAL_SERVER_ERROR);
export const imageStorageError = () =>
  new ImageApiException("IMAGE_STORAGE_ERROR", "Image generation storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR);
export const imageBudgetExceeded = (message: string) =>
  new ImageApiException("IMAGE_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const imageProviderError = (category: string, message: string) =>
  new ImageApiException("IMAGE_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, { category });
export const imageContentUnavailable = () =>
  new ImageApiException("IMAGE_CONTENT_UNAVAILABLE", "The requested scene image is unavailable.", HttpStatus.NOT_FOUND);

/**
 * The spend ledger could not be read, so no paid request is sent.
 *
 * Distinct from an exceeded budget on purpose: nothing was overspent, nothing knows what was spent, and the
 * place to go is a file rather than a limit. Every module sends this one code so the person reads one sentence
 * (docs/06_DECISIONS.md D-036).
 */
export const imageBudgetLedgerUnreadable = () =>
  new ImageApiException("BUDGET_LEDGER_UNREADABLE", "Monthly spend could not be read, so no paid request was sent.", HttpStatus.CONFLICT);
