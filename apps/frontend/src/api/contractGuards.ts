import { SCENE_FAILURE_REMEDIES, isSceneNumber as isValidSceneNumber, type BudgetPreview, type SceneFailure, type SceneNumber, type SceneStaleness } from "@ai-animation-studio/shared";

/**
 * The two optional bodies that ride along on every review response, checked in one place.
 *
 * The Long Episode clients have validated both since they shipped, with a written reason each: a malformed
 * budget shown as numbers is worse than showing none, and a staleness list the guard skips reaches the screen
 * typed as an array and valued as undefined. The short project's three review clients — image, narration,
 * video — validated neither, and their screens do exactly what those reasons warn about: they print the budget
 * and they narrow the staleness lists with `.filter` after a regeneration.
 *
 * One module rather than a copy per client because this repository has met the other outcome all week: four
 * copies of a check, one of them a field behind, and nothing that reports it. `styleStale` was added to
 * SceneStaleness the same day two separate guards were found not to be checking it.
 *
 * Both accept `undefined` — the field is optional on the contract, and absent is an ordinary answer. What they
 * refuse is a value that is present and not the shape it claims.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSceneNumber = (value: unknown): value is SceneNumber =>
  typeof value === "number" && Number.isInteger(value) && isValidSceneNumber(value);

const isSceneNumberList = (value: unknown): value is SceneNumber[] => Array.isArray(value) && value.every(isSceneNumber);

const isFiniteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function isBudgetPreview(value: unknown): value is BudgetPreview | undefined {
  if (value === undefined) return true;
  return isRecord(value) && isFiniteNonNegative(value.monthlyLimitUsd) && isFiniteNonNegative(value.spentUsd)
    && isFiniteNonNegative(value.remainingUsd) && isFiniteNonNegative(value.estimatedRequestCostUsd)
    && typeof value.canSpend === "boolean";
}

/** Every list the contract requires, so a screen that reads one of them cannot be handed an undefined. */
export function isSceneStaleness(value: unknown): value is SceneStaleness | undefined {
  if (value === undefined) return true;
  return isRecord(value) && isSceneNumberList(value.imageStale) && isSceneNumberList(value.styleStale)
    && isSceneNumberList(value.videoStale) && isSceneNumberList(value.videoFormatStale) && isSceneNumberList(value.narrationStale)
    && isSceneNumberList(value.referenceStale);
}

/**
 * One failed scene, described so a screen can act rather than guess — checked because it is read out loud in
 * front of a paid button.
 *
 * `billedOnFailure` becomes a sentence about the person's money and `remedy` decides whether the screen says
 * "다시 보내도 됩니다" or "그대로 보내면 다시 실패합니다" — and, under change_input, whether the submit waits
 * for a change at all. Fields that shape those three things must be the shape they claim, or the screen states
 * something about money from data nobody looked at.
 *
 * 🔴 Here rather than in either client for the reason at the top of this file. Both video pipelines fill this
 * map (local-video-workflow.service.ts writes it for the short project and the Episode alike), so a copy per
 * client is a copy that goes a field behind — which is the state this module was created to end.
 *
 * `remedy` is compared against the contract's own `SCENE_FAILURE_REMEDIES`, never a list retyped here: a
 * fourth remedy added to the contract must not be silently rejected by a copy that never heard of it.
 */
function isSceneFailure(value: unknown): value is SceneFailure {
  return isRecord(value)
    && typeof value.category === "string" && value.category.length > 0
    && (value.providerCode === undefined || (typeof value.providerCode === "string" && value.providerCode.length > 0))
    && (SCENE_FAILURE_REMEDIES as readonly string[]).includes(value.remedy as string)
    && typeof value.billedOnFailure === "boolean";
}

/** Keys arrive over JSON as numeric strings, so each must resolve to a real scene. Absent is an ordinary answer. */
export function isSceneFailureMap(value: unknown): value is Partial<Record<SceneNumber, SceneFailure>> | undefined {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, failure]) => isSceneNumber(Number(key)) && isSceneFailure(failure));
}
