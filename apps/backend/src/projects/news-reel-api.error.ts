import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

/**
 * What making a news reel can refuse with.
 *
 * 🟠 Three, and they split the way the photo card's do — by **what the person can do next**. A request that
 * does not fit the contract is theirs to fix in the boxes; a picture that cannot be read is theirs to fix in
 * the Library; a disk that refused is not theirs at all.
 */
export type NewsReelErrorCode =
  | "NEWS_REEL_INVALID_REQUEST"
  | "NEWS_REEL_ASSET_UNUSABLE"
  | "NEWS_REEL_STORAGE_ERROR";

class NewsReelApiException extends HttpException {
  constructor(code: NewsReelErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
    super(body, status);
  }
}

/**
 * 🟠 The default names no field on purpose — most of these are caught by the screen's own counters long before
 * here. The length refusals pass their own sentence, which names the box and how far over it was, because that
 * is the one case where the person is looking at text that seemed fine.
 */
export const newsReelInvalidRequest = (message = "릴을 만들 내용이 올바르지 않습니다.") =>
  new NewsReelApiException("NEWS_REEL_INVALID_REQUEST", message, HttpStatus.BAD_REQUEST);

export const newsReelCardUnusable = () =>
  new NewsReelApiException("NEWS_REEL_ASSET_UNUSABLE", "고른 그림을 읽을 수 없습니다.", HttpStatus.BAD_REQUEST);

export const newsReelStorageError = () =>
  new NewsReelApiException("NEWS_REEL_STORAGE_ERROR", "릴을 저장하지 못했습니다.", HttpStatus.INTERNAL_SERVER_ERROR);
