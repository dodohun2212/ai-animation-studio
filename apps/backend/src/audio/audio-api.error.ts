import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

export type AudioErrorCode =
  | "INVALID_REQUEST"
  | "AUDIO_TRACK_NOT_FOUND"
  | "AUDIO_FILE_INVALID"
  | "AUDIO_CONTENT_UNAVAILABLE"
  | "AUDIO_STORAGE_ERROR";

export class AudioApiException extends HttpException {
  constructor(code: AudioErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
    super(body, status);
  }
}

export const invalidAudioRequest = (message = "Request is invalid.") =>
  new AudioApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST);
export const audioTrackNotFound = () =>
  new AudioApiException("AUDIO_TRACK_NOT_FOUND", "That audio track was not found.", HttpStatus.NOT_FOUND);
export const invalidAudioFile = (message = "Audio file is invalid.") =>
  new AudioApiException("AUDIO_FILE_INVALID", message, HttpStatus.BAD_REQUEST);
export const audioContentUnavailable = () =>
  new AudioApiException("AUDIO_CONTENT_UNAVAILABLE", "That audio track's file is unavailable.", HttpStatus.NOT_FOUND);
export const audioStorageError = () =>
  new AudioApiException("AUDIO_STORAGE_ERROR", "BGM library storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR);
