import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";
import { BUDGET_LEDGER_UNREADABLE_CODE, BUDGET_LEDGER_UNREADABLE_MESSAGE } from "../providers/budget-ledger.js";

type StoryErrorCode = "INVALID_REQUEST" | "PROJECT_NOT_FOUND" | "STORY_PROMPT_STALE" | "STORY_PROMPT_STORAGE_ERROR" | "STORY_GENERATION_NOT_ALLOWED" | "STORY_GENERATION_FAILED" | "STORY_BUDGET_EXCEEDED" | "STORY_PROVIDER_ERROR" | "STORY_REGENERATION_NOT_ALLOWED" | "BUDGET_LEDGER_UNREADABLE" | "PROJECT_LOCKED";

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
export const storyGenerationNotAllowed = () =>
  new StoryApiException("STORY_GENERATION_NOT_ALLOWED", "Story generation requires a project in READY state.", HttpStatus.CONFLICT);
export const storyGenerationFailed = () =>
  new StoryApiException("STORY_GENERATION_FAILED", "Local Story generation did not produce a valid six-scene Story.", HttpStatus.INTERNAL_SERVER_ERROR);
export const storyBudgetExceeded = (message: string) =>
  new StoryApiException("STORY_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const storyProviderError = (category: string, message: string) =>
  new StoryApiException("STORY_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, { category });
export const storyRegenerationNotAllowed = () =>
  new StoryApiException("STORY_REGENERATION_NOT_ALLOWED", "Story regeneration requires an existing Story and no generated scene images yet.", HttpStatus.CONFLICT);

/**
 * The spend ledger could not be read, so no paid request is sent.
 *
 * Distinct from an exceeded budget on purpose: nothing was overspent, nothing knows what was spent, and the
 * place to go is a file rather than a limit. Every module sends this one code so the person reads one sentence
 * (docs/06_DECISIONS.md D-036).
 */
export const storyBudgetLedgerUnreadable = () =>
  new StoryApiException(BUDGET_LEDGER_UNREADABLE_CODE, BUDGET_LEDGER_UNREADABLE_MESSAGE, HttpStatus.CONFLICT);

/** A Story generation for this project is already running — see imageGenerationLocked for why this code and why it refuses instead of queuing. */
export const storyLocked = () =>
  new StoryApiException("PROJECT_LOCKED", "Story generation is already running for this project.", HttpStatus.CONFLICT);
