import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type Code = "INVALID_REQUEST" | "UNSAFE_PROJECT_ID" | "LONG_PROJECT_NOT_FOUND" | "LONG_PROJECT_ALREADY_EXISTS" | "LONG_PROJECT_JSON_MALFORMED" | "LONG_PROJECT_DATA_INVALID" | "LONG_PROJECT_STORAGE_ERROR" | "LONG_OUTLINE_STALE" | "LONG_OUTLINE_NOT_ALLOWED";

export class LongProjectApiException extends HttpException {
  constructor(code: Code, message: string, status: HttpStatus) { super({ code, message } satisfies ApiError, status); }
}
export const longInvalidRequest = (message = "Long project request is invalid.") => new LongProjectApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST);
export const longUnsafeId = () => new LongProjectApiException("UNSAFE_PROJECT_ID", "Project ID must contain only letters, numbers, '_' or '-'.", HttpStatus.BAD_REQUEST);
export const longNotFound = () => new LongProjectApiException("LONG_PROJECT_NOT_FOUND", "Long project was not found.", HttpStatus.NOT_FOUND);
export const longExists = () => new LongProjectApiException("LONG_PROJECT_ALREADY_EXISTS", "Long project already exists.", HttpStatus.CONFLICT);
export const longMalformed = () => new LongProjectApiException("LONG_PROJECT_JSON_MALFORMED", "Long project data is not valid JSON.", HttpStatus.INTERNAL_SERVER_ERROR);
export const longInvalidData = () => new LongProjectApiException("LONG_PROJECT_DATA_INVALID", "Long project data is invalid.", HttpStatus.INTERNAL_SERVER_ERROR);
export const longStorageError = () => new LongProjectApiException("LONG_PROJECT_STORAGE_ERROR", "Long project storage could not be read or written.", HttpStatus.INTERNAL_SERVER_ERROR);
export const longOutlineStale = () => new LongProjectApiException("LONG_OUTLINE_STALE", "The outline prompt is stale. Preview it again before approval.", HttpStatus.CONFLICT);
export const longOutlineNotAllowed = () => new LongProjectApiException("LONG_OUTLINE_NOT_ALLOWED", "Outline approval requires a planned long project.", HttpStatus.CONFLICT);
