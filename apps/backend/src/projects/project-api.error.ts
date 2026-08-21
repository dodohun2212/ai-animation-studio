import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

export type ProjectErrorCode =
  | "INVALID_REQUEST"
  | "UNSAFE_PROJECT_ID"
  | "PROJECT_ALREADY_EXISTS"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_JSON_MALFORMED"
  | "PROJECT_DATA_INVALID"
  | "PROJECT_STORAGE_ERROR";

export class ProjectApiException extends HttpException {
  constructor(
    code: ProjectErrorCode,
    message: string,
    status: HttpStatus,
    details?: Record<string, unknown>,
  ) {
    const body: ApiError = details ? { code, message, details } : { code, message };
    super(body, status);
  }
}

export function invalidRequest(message: string, details?: Record<string, unknown>): ProjectApiException {
  return new ProjectApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST, details);
}

export function unsafeProjectId(): ProjectApiException {
  return new ProjectApiException(
    "UNSAFE_PROJECT_ID",
    "Project ID must contain only letters, numbers, '_' or '-' and must not be empty.",
    HttpStatus.BAD_REQUEST,
  );
}

export function projectAlreadyExists(projectId: string): ProjectApiException {
  return new ProjectApiException(
    "PROJECT_ALREADY_EXISTS",
    `Project "${projectId}" already exists.`,
    HttpStatus.CONFLICT,
  );
}

export function projectNotFound(projectId: string): ProjectApiException {
  return new ProjectApiException(
    "PROJECT_NOT_FOUND",
    `Project "${projectId}" was not found.`,
    HttpStatus.NOT_FOUND,
  );
}

export function jsonMalformed(projectId: string): ProjectApiException {
  return new ProjectApiException(
    "PROJECT_JSON_MALFORMED",
    `Project "${projectId}" data is not valid JSON.`,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

export function dataInvalid(message: string): ProjectApiException {
  return new ProjectApiException("PROJECT_DATA_INVALID", message, HttpStatus.INTERNAL_SERVER_ERROR);
}

export function storageError(message: string): ProjectApiException {
  return new ProjectApiException("PROJECT_STORAGE_ERROR", message, HttpStatus.INTERNAL_SERVER_ERROR);
}
