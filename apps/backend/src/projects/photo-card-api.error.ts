import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type Code = "INVALID_REQUEST" | "PHOTO_CARD_ASSET_UNUSABLE" | "PHOTO_CARD_STORAGE_ERROR";

class PhotoCardApiException extends HttpException {
  constructor(code: Code, message: string, status: HttpStatus) {
    super({ code, message } satisfies ApiError, status);
  }
}

export const photoCardInvalidRequest = () =>
  new PhotoCardApiException("INVALID_REQUEST", "Photo card request is invalid.", HttpStatus.BAD_REQUEST);
/** The chosen Library picture is gone or unreadable — said as its own thing, because the fix is picking another picture, not retrying. */
export const photoCardAssetUnusable = () =>
  new PhotoCardApiException("PHOTO_CARD_ASSET_UNUSABLE", "The chosen picture could not be read from the Asset Library.", HttpStatus.CONFLICT);
export const photoCardStorageError = () =>
  new PhotoCardApiException("PHOTO_CARD_STORAGE_ERROR", "Photo card could not be written.", HttpStatus.INTERNAL_SERVER_ERROR);
