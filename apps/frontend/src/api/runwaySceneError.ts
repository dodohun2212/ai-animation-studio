import { BUDGET_LIMIT_ROUTE_HINT, providerTaskFailure } from "@ai-animation-studio/shared";

import { BUDGET_LEDGER_UNREADABLE_MESSAGE } from "./budgetLedgerError.js";

/**
 * One failed scene, one sentence, defined once — for both pipelines.
 *
 * This table lived twice: `videoWorkflowApi.ts` (short projects) and `longProjectsApi.ts` (Episodes), with a
 * comment on each saying it was "an identical, independent copy" of the other. It was not. `quota_or_permission`
 * and `submit_interrupted` existed on the short side only, and the two things that cost are exactly what those
 * two cells say:
 *
 *   quota_or_permission   An Episode scene that failed for want of credit read 「영상 생성에 실패했습니다.
 *                         잠시 후 다시 시도해 주세요」 — so the person pressed again, against an empty account,
 *                         instead of going to top it up.
 *   submit_interrupted    This cell exists to say **do not send it again**. Without it the fallback says the
 *                         opposite, and that is the sentence that was followed twice and charged twice on
 *                         2026-09-05 (docs/06_DECISIONS.md D-010).
 *
 * A pairing test was added to hold the two copies together, and it did its job — but a test that says "these
 * two must stay equal" is a guard around a duplicate, not a reason for one. The backend already runs **one**
 * classifier for both pipelines (`RunwayErrorCategory`, and `runway-workflow-support.ts` is shared by
 * `episode-videos.service.ts`), so one classifier answering into two hand-typed tables was the asymmetry.
 * This is the same move `budgetLedgerError.ts` made, and for the same reason: a sentence that must stay
 * identical as new paid paths are added is a constant, not a habit of copying carefully.
 *
 * 🟠 Still hand-typed against the backend's closed set. The keys are the backend's categories plus the two
 * codes this app synthesizes; when CLI exports that union to `shared`, this reads the contract instead of
 * repeating it — and then the keys themselves are checked, not just the sentences.
 *
 * Only the closed set below gets an actionable Korean sentence. Anything else — including Runway's own raw
 * free-text failure reason, which arrives in the same field — is treated as opaque and shown with the generic
 * fallback rather than surfaced verbatim.
 */
export const RUNWAY_SCENE_ERROR_MESSAGES: Record<string, string> = {
  authentication: "Runway API 키 인증에 실패했습니다. API 설정 화면에서 키가 올바른지 확인해 주세요.",
  permission: "Runway 사용 권한 문제로 요청이 거부되었습니다. Runway 계정 상태를 확인해 주세요.",
  // Runway answers "not enough credits" with a 400, which used to land in `invalid_request` — so a person
  // whose account simply needed topping up was told the request format was unsupported and to report a bug.
  // The backend now re-reads the response body it already had and splits this out (Round 145).
  quota_or_permission: "Runway 크레딧이 부족합니다. Runway 계정에서 크레딧을 충전한 뒤 다시 시도해 주세요.",
  rate_limit: "Runway 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  invalid_request: "요청 형식이 지원되지 않습니다. 문제가 계속되면 알려주세요.",
  server: "Runway 서버에 일시적인 오류가 있습니다. 잠시 후 다시 시도해 주세요.",
  network: "Runway 연결이 시간 초과되었거나 네트워크에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
  timeout: "영상 생성이 제한 시간 안에 끝나지 않았습니다. 다시 시도해 주세요.",
  no_output: "Runway가 영상 결과물을 반환하지 않았습니다. 다시 시도해 주세요.",
  invalid_state: "영상 작업 상태가 예상과 달라 처리하지 못했습니다. 다시 시도해 주세요.",
  budget_exceeded: `이번 달 Runway 예산을 초과하여 요청을 보내지 않았습니다. ${BUDGET_LIMIT_ROUTE_HINT}`,
  // Not budget_exceeded. Reusing that reason would be a lie about money — nothing was overspent; the ledger
  // itself could not be read, so the amount spent is unknown and the request was never sent. Same sentence as
  // the HTTP-code label because it is the same cause, and one cause reading two ways is how a person ends up
  // fixing the wrong thing.
  budget_ledger_unreadable: BUDGET_LEDGER_UNREADABLE_MESSAGE,
  // The request went out but its outcome was never confirmed (the server stopped in between). Retrying on the
  // user's behalf could create a second billed task for one scene, so the backend deliberately stops here and
  // leaves the decision to the person paying — this message has to say that plainly, not read as a transient
  // glitch, or they will assume nothing happened and press again.
  submit_interrupted: "요청을 보낸 뒤 서버가 중단되어 결과를 확인하지 못했습니다. 요청이 이미 접수되었을 수 있어 자동으로 다시 보내지 않았습니다. Runway 계정에서 해당 작업이 생성되었는지 확인한 뒤 다시 시도해 주세요.",
};

export const RUNWAY_SCENE_ERROR_FALLBACK = "영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * The sentence for one failed scene — the provider's code first, this app's categories after.
 *
 * 🔴 A Runway task failure's `category` is the provider's own English sentence
 * ("An unexpected error occurred. (Runway code: INTERNAL.BAD_OUTPUT.CODE01)"), so it missed the table above
 * every time and fell through to "영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." That is the sentence
 * that was followed twice and charged twice on 2026-09-05 — and since the remedy advice shipped, it has been
 * sitting directly above it saying the opposite. One failure, two sentences, and no way to tell which is right.
 *
 * The codes and their causes live in the contract's `PROVIDER_TASK_FAILURES`, not here: the adapter already
 * decides `remedy` from those same strings, and a second list keyed on them is the copy this repository keeps
 * finding — one that would drift in the worst direction.
 *
 * Cause only. Whether the attempt was charged is `billedOnFailure`'s sentence to make, one screen away, and
 * two sentences about one person's money is how the two end up disagreeing.
 */
export function runwaySceneErrorMessage(code: string | undefined, providerCode?: string): string {
  const known = providerTaskFailure(providerCode);
  if (known) return known.message;
  if (!code) return RUNWAY_SCENE_ERROR_FALLBACK;
  return RUNWAY_SCENE_ERROR_MESSAGES[code] ?? RUNWAY_SCENE_ERROR_FALLBACK;
}
