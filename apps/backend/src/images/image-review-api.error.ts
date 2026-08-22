import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type ImageReviewErrorCode =
  | "INVALID_REQUEST"
  | "IMAGE_REVIEW_NOT_ALLOWED"
  | "IMAGE_REVIEW_IMAGE_INVALID"
  | "IMAGE_REVIEW_DATA_INVALID"
  | "IMAGE_REVIEW_STORAGE_ERROR";

class ImageReviewApiException extends HttpException {
  constructor(code: ImageReviewErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
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
