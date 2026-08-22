import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type ImageErrorCode = "INVALID_REQUEST" | "IMAGE_GENERATION_NOT_ALLOWED" | "ASSET_MAPPING_REVIEW_REQUIRED" | "IMAGE_GENERATION_FAILED" | "IMAGE_STORAGE_ERROR";

class ImageApiException extends HttpException {
  constructor(code: ImageErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
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
