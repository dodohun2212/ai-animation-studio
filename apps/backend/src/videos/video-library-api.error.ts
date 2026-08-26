import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type VideoLibraryErrorCode =
  | "VIDEO_LIBRARY_VERSION_NOT_FOUND"
  | "VIDEO_LIBRARY_CONTENT_UNAVAILABLE"
  | "VIDEO_LIBRARY_RESTORE_NOT_ALLOWED"
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
export const videoLibraryStorageError = () =>
  new VideoLibraryApiException("VIDEO_LIBRARY_STORAGE_ERROR", "Video library state could not be saved.", HttpStatus.INTERNAL_SERVER_ERROR);
