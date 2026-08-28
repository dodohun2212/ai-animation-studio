import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

export type ProjectErrorCode =
  | "INVALID_REQUEST"
  | "UNSAFE_PROJECT_ID"
  | "PROJECT_ALREADY_EXISTS"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_JSON_MALFORMED"
  | "PROJECT_DATA_INVALID"
  | "PROJECT_STORAGE_ERROR"
  | "PROJECT_ARCHIVE_NOT_ALLOWED"
  | "PROJECT_ARCHIVE_COLLISION"
  | "PROJECT_RESTORE_COLLISION"
  | "PROJECT_SCENE_COUNT_LOCKED";

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

export function projectArchiveNotAllowed(): ProjectApiException {
  return new ProjectApiException(
    "PROJECT_ARCHIVE_NOT_ALLOWED",
    "A project with active generation or rendering work cannot be archived.",
    HttpStatus.CONFLICT,
  );
}

export function projectArchiveCollision(): ProjectApiException {
  return new ProjectApiException(
    "PROJECT_ARCHIVE_COLLISION",
    "A recoverable archive already exists for this project.",
    HttpStatus.CONFLICT,
  );
}

export function projectRestoreCollision(): ProjectApiException {
  return new ProjectApiException(
    "PROJECT_RESTORE_COLLISION",
    "An active project already exists at this project's original location.",
    HttpStatus.CONFLICT,
  );
}

/**
 * The scene count cannot be changed once a Story has been written to it.
 *
 * Without this the change is accepted and the project quietly stops being able to move on: Asset Mapping review
 * counts scenes from the settings and the Story from its own, so the next step refuses with "Exactly N Story
 * scenes are required" — a number the person never typed, about a change they made somewhere else. Refusing here
 * names the actual cause while they are still looking at the thing they changed.
 *
 * Only the scene count. Clip length does not go into the Story prompt on this side, so changing it leaves
 * nothing inconsistent — unlike the Long Project's Episode, where both are in the prompt and both are refused.
 */
export function sceneCountLocked(storyScenes: number): ProjectApiException {
  return new ProjectApiException("PROJECT_SCENE_COUNT_LOCKED",
    `This project's Story already has ${storyScenes} scenes. Regenerate the Story to change how many it has.`,
    HttpStatus.CONFLICT);
}
