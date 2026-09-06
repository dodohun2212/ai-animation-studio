import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type Code = "INVALID_REQUEST" | "FLOWER_CARD_STORAGE_ERROR";

class FlowerCardApiException extends HttpException {
  constructor(code: Code, message: string, status: HttpStatus) {
    super({ code, message } satisfies ApiError, status);
  }
}

export const flowerCardInvalidRequest = () =>
  new FlowerCardApiException("INVALID_REQUEST", "Flower card request is invalid.", HttpStatus.BAD_REQUEST);

/**
 * The record could not be written. Its own code rather than the shared internal one, for the same reason the
 * photo card has one: the screen this reaches has a project the person just typed, and the difference between
 * "that name is taken" and "the disk refused" decides whether they change the name or stop.
 *
 * `PROJECT_ALREADY_EXISTS` is passed through untouched, never folded into this.
 */
export const flowerCardStorageError = () =>
  new FlowerCardApiException("FLOWER_CARD_STORAGE_ERROR", "Flower card could not be written.", HttpStatus.INTERNAL_SERVER_ERROR);
