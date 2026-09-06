import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

export type InstagramErrorCode =
  | "INVALID_REQUEST"
  | "INSTAGRAM_NOT_CONNECTED"
  | "INSTAGRAM_TARGET_NOT_FOUND"
  | "INSTAGRAM_STORAGE_ERROR"
  | "INSTAGRAM_PROVIDER_ERROR"
  | "INSTAGRAM_ALREADY_PUBLISHED"
  | "INSTAGRAM_POST_NOT_RECORDED"
  | "INSTAGRAM_VIDEO_UNAVAILABLE"
  | "INSTAGRAM_VIDEO_RENDERING"
  | "INSTAGRAM_PUBLISH_IN_PROGRESS"
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

/**
 * There is no stored post to clear. Reported rather than silently succeeding: "nothing happened because there
 * was nothing there" and "the record was cleared" leave the same state but mean different things to a person
 * who is about to publish a second copy.
 */
export const instagramPostNotRecorded = () =>
  new InstagramApiException("INSTAGRAM_POST_NOT_RECORDED", "This video has no published record to clear.", HttpStatus.CONFLICT);

export const instagramVideoUnavailable = () =>
  new InstagramApiException("INSTAGRAM_VIDEO_UNAVAILABLE", "There is no merged final video to publish yet.", HttpStatus.CONFLICT);

/**
 * The final video is being written right now, so the bytes on disk are not a finished video and will not be
 * the ones this project ends up with.
 *
 * Its own code rather than "there is no video": that sentence sends the person to merge, which is exactly what
 * is already happening. Waiting is the whole answer here, and the two situations must not share a message.
 */
export const instagramVideoRendering = () =>
  new InstagramApiException("INSTAGRAM_VIDEO_RENDERING", "This project's final video is being rendered right now.", HttpStatus.CONFLICT);

/**
 * A publish for this project is already running and this call could not get in.
 *
 * Every other project-locked operation already maps the lock timeout to a sentence of its own; publishing was
 * the one that did not, and it is the one that cannot be undone. The timeout is ten seconds and a publish holds
 * the lock for minutes (upload, then up to three minutes of processing polls), so a second press during a real
 * publish always hit it — and, uncaught, came back as an unexplained 500. A person who already believes the
 * first attempt failed reads that as a second failure and presses again.
 *
 * The message says not to press again rather than to wait, because the request that appears to have failed may
 * well be succeeding: the record is written only after Instagram accepts, so during those minutes the app
 * genuinely does not know yet. 「Nothing was published」 is the one thing this must never imply.
 */
export const instagramPublishInProgress = () =>
  new InstagramApiException("INSTAGRAM_PUBLISH_IN_PROGRESS", "A publish for this project is already running. Do not publish again until it finishes — check the Instagram account before retrying.", HttpStatus.CONFLICT);

/** The attempt ended without a post — nothing was published, so trying again is safe. */
export const instagramPublishFailed = (message: string) =>
  new InstagramApiException("INSTAGRAM_PUBLISH_FAILED", message, HttpStatus.BAD_GATEWAY);
