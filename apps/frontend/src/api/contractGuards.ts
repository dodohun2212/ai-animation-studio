import { isSceneNumber as isValidSceneNumber, type BudgetPreview, type SceneNumber, type SceneStaleness } from "@ai-animation-studio/shared";

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
    && isSceneNumberList(value.videoStale) && isSceneNumberList(value.narrationStale)
    && isSceneNumberList(value.referenceStale);
}
