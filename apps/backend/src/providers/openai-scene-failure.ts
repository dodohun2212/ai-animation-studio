import type { ImageFailureScope, ImageGenerationFailureDetails, SceneFailureRemedy, SceneNumber } from "@ai-animation-studio/shared";

import type { OpenAiErrorCategory } from "../providers/openai-common.js";

/**
 * Which remedy sentence is true for each OpenAI category — the one place that decides it (docs/00_NOW.md ②-2).
 *
 * Exhaustive over `OpenAiErrorCategory`, so a new category does not compile until someone says what a person should
 * do about it. `undefined` is an answer, not a gap: it means none of the three remedy sentences is true, and the
 * screen keeps the category's own sentence (see ImageGenerationFailureDetails.remedy).
 *
 * `unknown` is `retry` because that is what the video side's table answers for a code it does not know, and the two
 * pipelines should not disagree about the same uncertainty.
 */
const REMEDY: Record<OpenAiErrorCategory, SceneFailureRemedy | undefined> = {
  rate_limit: "retry",
  server: "retry",
  network: "retry",
  unknown: "retry",
  invalid_request: "change_input",
  safety_policy: "change_input",
  context_length_exceeded: "change_input",
  authentication: undefined,
  quota_or_permission: undefined,
};

/** The details every image provider failure carries — see ImageGenerationFailureDetails in the contract. */
export function imageFailureDetails(category: string, sceneNumber: SceneNumber, scope: ImageFailureScope): ImageGenerationFailureDetails {
  const remedy = (REMEDY as Record<string, SceneFailureRemedy | undefined>)[category];
  // Every paid image call is recorded at its estimate in a `finally`, failure included, so a provider failure is
  // always one the budget counted.
  return { category, sceneNumber, scope, billedOnFailure: true, ...(remedy ? { remedy } : {}) };
}
