import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type StoryErrorCode = "INVALID_REQUEST" | "PROJECT_NOT_FOUND" | "STORY_PROMPT_STALE" | "STORY_PROMPT_STORAGE_ERROR";

class StoryApiException extends HttpException {
  constructor(code: StoryErrorCode, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    const body: ApiError = details ? { code, message, details } : { code, message };
    super(body, status);
  }
}

export const invalidStoryRequest = (message: string, details?: Record<string, unknown>) =>
  new StoryApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST, details);
export const storyPromptStale = () =>
  new StoryApiException("STORY_PROMPT_STALE", "The Story prompt changed; create a new preview before approval.", HttpStatus.CONFLICT);
export const storyStorageError = () =>
  new StoryApiException("STORY_PROMPT_STORAGE_ERROR", "Story prompt storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR);
