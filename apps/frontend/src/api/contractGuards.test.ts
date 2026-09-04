import { describe, expect, it } from "vitest";

import { isBudgetPreview, isSceneStaleness } from "./contractGuards.js";
import { sceneStaleness } from "./testUtils.js";

/**
 * Both fields are optional on the contract, so the question these answer is not "is it there" but "if it is
 * there, is it what it says". A guard that skips the field tells the compiler the whole type arrived: the
 * screens print budget numbers and call `.filter` on the staleness lists.
 */
describe("contractGuards", () => {
  const budget = { monthlyLimitUsd: 10, spentUsd: 1, remainingUsd: 9, estimatedRequestCostUsd: 0.5, canSpend: true };

  it("accepts an absent field, because absent is an ordinary answer", () => {
    expect(isBudgetPreview(undefined)).toBe(true);
    expect(isSceneStaleness(undefined)).toBe(true);
  });

  it("accepts the shapes the server actually sends", () => {
    expect(isBudgetPreview(budget)).toBe(true);
    expect(isSceneStaleness(sceneStaleness())).toBe(true);
    expect(isSceneStaleness(sceneStaleness({ imageStale: [1], styleStale: [2] }))).toBe(true);
  });

  it("refuses a staleness missing any single required list", () => {
    for (const dropped of ["imageStale", "styleStale", "videoStale", "narrationStale", "referenceStale"] as const) {
      const { [dropped]: _gone, ...rest } = sceneStaleness();
      expect(isSceneStaleness(rest), `${dropped} went unchecked`).toBe(false);
    }
  });

  it("refuses a staleness whose list is not scene numbers", () => {
    expect(isSceneStaleness({ ...sceneStaleness(), imageStale: [0] })).toBe(false);
    expect(isSceneStaleness({ ...sceneStaleness(), styleStale: ["1"] })).toBe(false);
  });

  /** A wrong number shown as a spend limit is worse than showing none — the reason the Episode side has always checked. */
  it("refuses a budget with a missing, negative, or non-finite amount", () => {
    const { spentUsd: _gone, ...missing } = budget;
    expect(isBudgetPreview(missing)).toBe(false);
    expect(isBudgetPreview({ ...budget, remainingUsd: -1 })).toBe(false);
    expect(isBudgetPreview({ ...budget, monthlyLimitUsd: Number.NaN })).toBe(false);
    expect(isBudgetPreview({ ...budget, canSpend: "yes" })).toBe(false);
  });
});
