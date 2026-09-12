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
// Says whether the paid request had already gone out (StoryStorageErrorDetails) — the difference between "nothing was
// sent" and "a script may already exist", which is the difference between pressing again and checking first.
export const storyStorageError = (requestSent: boolean) =>
  new StoryApiException("STORY_PROMPT_STORAGE_ERROR", "Story prompt storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR, { requestSent });
export const storyGenerationNotAllowed = () =>
  new StoryApiException("STORY_GENERATION_NOT_ALLOWED", "Story generation requires a project in READY state.", HttpStatus.CONFLICT);
/**
 * Story generation ended for a reason nothing above it recognised.
 *
 * The message said "Local Story generation did not produce a valid six-scene Story", and both halves were
 * wrong. This is the fallback arm of a catch in StoryPromptService.approve, so an unexpected error on the
 * *paid* path lands here too — the known ones (budget ledger, budget exceeded, the provider's own error) are
 * each mapped ahead of it. And the scene count comes from the project's settings: `generateLocalStory` builds
 * `sceneCount` scenes and the adapter builds its schema from the same number, so a fixed six has been untrue
 * since scene count became a setting.
 *
 * Neither half ever reached a person — screens branch on the code and render their own text — so this misled
 * only the next reader of this file, which is exactly who a message like this is for.
 */
export const storyGenerationFailed = () =>
  new StoryApiException("STORY_GENERATION_FAILED", "Story generation failed for a reason this app does not recognise.", HttpStatus.INTERNAL_SERVER_ERROR);
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
