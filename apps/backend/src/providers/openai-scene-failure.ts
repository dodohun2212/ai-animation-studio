import type { ImageFailureScope, ImageGenerationFailureDetails, SceneFailureRemedy, SceneNumber } from "@ai-animation-studio/shared";

import type { OpenAiErrorCategory } from "./openai-common.js";

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

/** What the provider said about this refusal, as the adapter carried it out — see OpenAiAdapterError.failure. */
export interface ProviderSpeech { providerMessage?: string; providerRequestId?: string }

/** The details every image provider failure carries — see ImageGenerationFailureDetails in the contract. */
export function openAiSceneFailureDetails(category: string, sceneNumber: SceneNumber, scope: ImageFailureScope, spoken: ProviderSpeech = {}): ImageGenerationFailureDetails {
  const remedy = (REMEDY as Record<string, SceneFailureRemedy | undefined>)[category];
  // Every paid image call is recorded at its estimate in a `finally`, failure included, so a provider failure is
  // always one the budget counted.
  return {
    category, sceneNumber, scope, billedOnFailure: true,
    ...(remedy ? { remedy } : {}),
    ...(spoken.providerMessage ? { providerMessage: spoken.providerMessage } : {}),
    ...(spoken.providerRequestId ? { providerRequestId: spoken.providerRequestId } : {}),
  };
}

/**
 * The line a stopped paid run leaves behind in the project's own file.
 *
 * 🔴 Why this exists at all: before it, a refused run left `errors: []`, `warnings: []` and a workflow state
 * rolled back to where it started. The only trace of a paid failure was one `succeeded: false` row in the
 * spend ledger, which says a call failed and not one word about why — and the screen's red line was gone the
 * moment anyone reloaded. A whole session went into re-deriving, from that row and its timestamp, a reason the
 * refusal had stated plainly.
 *
 * 🟠 Quotes the provider rather than paraphrasing it. Our own sentence is the category's, which is already on
 * screen; the value here is the half we do not write. `providerMessage` is redacted and capped upstream
 * (openai-common.ts) — it arrives ready to be written down.
 *
 * Identity is the whole sentence, the same rule `withWarning` follows: two runs refused at different scenes,
 * or for different reasons, are two facts and both belong; the same refusal twice is one fact said twice.
 */
export const IMAGE_RUN_FAILURE_PREFIX = "장면 이미지 생성이 중단되었습니다";

export function imageRunFailureRecord(sceneNumber: SceneNumber, ourSentence: string, spoken: ProviderSpeech = {}): string {
  const quoted = spoken.providerMessage ? ` 제공자가 보낸 사유: “${spoken.providerMessage}”` : "";
  const id = spoken.providerRequestId ? ` (요청 번호 ${spoken.providerRequestId})` : "";
  return `${IMAGE_RUN_FAILURE_PREFIX} — ${sceneNumber}번 장면에서 ${ourSentence}${quoted}${id}`;
}
