import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type VideoLibraryErrorCode =
  | "VIDEO_LIBRARY_VERSION_NOT_FOUND"
  | "VIDEO_LIBRARY_CONTENT_UNAVAILABLE"
  | "VIDEO_LIBRARY_RESTORE_NOT_ALLOWED"
  | "VIDEO_LIBRARY_RESTORE_IN_PROGRESS"
  | "VIDEO_LIBRARY_STORAGE_ERROR"
  | "INVALID_REQUEST";

class VideoLibraryApiException extends HttpException {
  constructor(code: VideoLibraryErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
    super(body, status);
  }
}

export const videoLibraryInvalidRequest = (message = "Request is invalid.") =>
  new VideoLibraryApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST);
export const videoLibraryVersionNotFound = () =>
  new VideoLibraryApiException("VIDEO_LIBRARY_VERSION_NOT_FOUND", "That video version does not exist.", HttpStatus.NOT_FOUND);
export const videoLibraryContentUnavailable = () =>
  new VideoLibraryApiException("VIDEO_LIBRARY_CONTENT_UNAVAILABLE", "That video version's file is unavailable.", HttpStatus.NOT_FOUND);
export const videoLibraryRestoreNotAllowed = (message = "That version is already current.") =>
  new VideoLibraryApiException("VIDEO_LIBRARY_RESTORE_NOT_ALLOWED", message, HttpStatus.CONFLICT);
/**
 * Something else is already writing this project's final video — a merge, a publish, or another restore.
 *
 * 🔴 Reachable only since restore started taking FINAL_VIDEO_LOCK_KEY instead of a key of its own. Under the
 * old key a restore waited for nothing but another restore, which is why this refusal did not exist: the
 * conflict it names could not be detected, it just happened.
 *
 * Its own code rather than RESTORE_NOT_ALLOWED, which means "the project's state forbids this" — a fact that
 * does not change while you wait. This one does: the right move is to wait for the running operation and press
 * again, and telling someone their state forbids a restore that will work in a minute sends them looking for
 * the wrong thing.
 */
export const videoLibraryRestoreInProgress = () =>
  new VideoLibraryApiException("VIDEO_LIBRARY_RESTORE_IN_PROGRESS", "Another operation is writing this project's final video. Wait for it to finish and try again.", HttpStatus.CONFLICT);
export const videoLibraryStorageError = () =>
  new VideoLibraryApiException("VIDEO_LIBRARY_STORAGE_ERROR", "Video library state could not be saved.", HttpStatus.INTERNAL_SERVER_ERROR);
