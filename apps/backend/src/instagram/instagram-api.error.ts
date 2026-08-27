import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

export type InstagramErrorCode =
  | "INVALID_REQUEST"
  | "INSTAGRAM_NOT_CONNECTED"
  | "INSTAGRAM_TARGET_NOT_FOUND"
  | "INSTAGRAM_STORAGE_ERROR"
  | "INSTAGRAM_PROVIDER_ERROR"
  | "INSTAGRAM_ALREADY_PUBLISHED"
  | "INSTAGRAM_VIDEO_UNAVAILABLE"
  | "INSTAGRAM_PUBLISH_FAILED";

export class InstagramApiException extends HttpException {
  constructor(code: InstagramErrorCode, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    super((details ? { code, message, details } : { code, message }) satisfies ApiError, status);
  }
}

export const invalidInstagramRequest = (message = "Instagram request is invalid.") =>
  new InstagramApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST);

/**
 * No stored token, or Meta rejected the one we have. Deliberately distinct from an empty target list: "there is
 * no account to publish to" and "you need to sign in" leave the user with completely different things to do,
 * and an empty list in place of this would send someone to fix their Instagram account when the real problem is
 * a login that expired (docs/06_DECISIONS.md D-014).
 */
export const instagramNotConnected = () =>
  new InstagramApiException("INSTAGRAM_NOT_CONNECTED", "Instagram is not connected, or the saved login has expired.", HttpStatus.CONFLICT);

/** The requested account is not among the ones this token can actually publish to right now — see InstagramTargetsService.select() for why this is checked server-side rather than trusted. */
export const instagramTargetNotFound = () =>
  new InstagramApiException("INSTAGRAM_TARGET_NOT_FOUND", "That Instagram account is not available to publish to.", HttpStatus.NOT_FOUND);

export const instagramStorageError = () =>
  new InstagramApiException("INSTAGRAM_STORAGE_ERROR", "Instagram settings storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR);

/**
 * Meta rejected the request for a reason that is not an expired login — category is carried in details for the
 * frontend to branch on, never Meta's own wording.
 *
 * `diagnostics` carries only numbers Meta answered with (HTTP status, Graph code and subcode). They travel
 * because a category that looks wrong can only be told apart from a real outage by the values it came from, and
 * unlike Meta's message text there is nothing in them to leak.
 */
// `object` rather than a named shape: this only ever forwards numbers, and typing it to one caller's
// interface would make the next caller's shape a compile error for no reason the reader could act on.
export const instagramProviderError = (category: string, message: string, diagnostics?: object) => {
  const numbers = Object.entries(diagnostics ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return new InstagramApiException("INSTAGRAM_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, {
    category,
    ...(numbers.length ? { diagnostics: Object.fromEntries(numbers) } : {}),
  });
};

/**
 * This project's final video has already been posted. Refused rather than posted again: a duplicate charge can
 * be argued with, a duplicate post has already been seen by everyone who saw it (D-005).
 */
export const instagramAlreadyPublished = () =>
  new InstagramApiException("INSTAGRAM_ALREADY_PUBLISHED", "This project's video has already been published to Instagram.", HttpStatus.CONFLICT);

export const instagramVideoUnavailable = () =>
  new InstagramApiException("INSTAGRAM_VIDEO_UNAVAILABLE", "There is no merged final video to publish yet.", HttpStatus.CONFLICT);

/** The attempt ended without a post — nothing was published, so trying again is safe. */
export const instagramPublishFailed = (message: string) =>
  new InstagramApiException("INSTAGRAM_PUBLISH_FAILED", message, HttpStatus.BAD_GATEWAY);
