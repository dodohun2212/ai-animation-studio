import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type ImageReviewErrorCode =
  | "INVALID_REQUEST"
  | "IMAGE_REVIEW_NOT_ALLOWED"
  | "IMAGE_REVIEW_IMAGE_INVALID"
  | "IMAGE_REVIEW_DATA_INVALID"
  | "IMAGE_REVIEW_STORAGE_ERROR"
  | "IMAGE_REVIEW_BUDGET_EXCEEDED"
  | "IMAGE_REVIEW_PROVIDER_ERROR";

class ImageReviewApiException extends HttpException {
  constructor(code: ImageReviewErrorCode, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    const body: ApiError = details ? { code, message, details } : { code, message };
    super(body, status);
  }
}

export const invalidImageReviewRequest = () =>
  new ImageReviewApiException("INVALID_REQUEST", "Image review requires explicit approval.", HttpStatus.BAD_REQUEST);
export const imageReviewNotAllowed = () =>
  new ImageReviewApiException("IMAGE_REVIEW_NOT_ALLOWED", "Image review requires a project in IMAGES_REVIEW state.", HttpStatus.CONFLICT);
export const imageReviewImageInvalid = () =>
  new ImageReviewApiException("IMAGE_REVIEW_IMAGE_INVALID", "A valid generated PNG is required for this scene.", HttpStatus.CONFLICT);
export const imageReviewDataInvalid = () =>
  new ImageReviewApiException("IMAGE_REVIEW_DATA_INVALID", "Generated image review data is invalid.", HttpStatus.INTERNAL_SERVER_ERROR);
export const imageReviewStorageError = () =>
  new ImageReviewApiException("IMAGE_REVIEW_STORAGE_ERROR", "Generated image review storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR);
export const imageReviewBudgetExceeded = (message: string) =>
  new ImageReviewApiException("IMAGE_REVIEW_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const imageReviewProviderError = (category: string, message: string) =>
  new ImageReviewApiException("IMAGE_REVIEW_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, { category });
