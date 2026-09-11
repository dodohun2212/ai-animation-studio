import { describe, expect, it } from "vitest";

import { isBudgetPreview, isSceneFailureMap, isSceneStaleness } from "./contractGuards.js";
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

  /**
   * 🔴 `remedy` 가 없는 실패는 **정상답**입니다. 세 조치 문장은 전부 「이 장면의 입력」 에 대한 말이라,
   * 답이 그 셋 중 어느 것도 아닌 실패에는 계약이 칸을 빼고 보냅니다(`submit_interrupted`, 그리고
   * 이미지 쪽의 `authentication` · `quota_or_permission`).
   *
   * 이 가드가 필수로 보던 동안은 백엔드가 그걸 모를 수가 없었습니다 — 빼는 순간 진행 응답 전체가
   * 형식 오류가 돼서 화면이 「서버 응답을 확인할 수 없습니다」만 말하게 됩니다. 그래서 이 짝은 둘을
   * 동시에 봅니다: 없으면 받고, 있는데 모르는 값이면 거절합니다.
   */
  describe("isSceneFailureMap", () => {
    const failure = { category: "server", providerCode: "INTERNAL.BAD_OUTPUT", remedy: "retry", billedOnFailure: true };

    it("accepts a failure that carries no remedy, because none of the three would be true", () => {
      const { remedy: _none, ...withoutRemedy } = failure;
      expect(isSceneFailureMap({ 1: withoutRemedy })).toBe(true);
      // 여전히 진짜 값은 받습니다.
      expect(isSceneFailureMap({ 1: failure })).toBe(true);
      expect(isSceneFailureMap(undefined)).toBe(true);
    });

    it("still refuses a remedy it does not recognise, rather than passing the string through", () => {
      expect(isSceneFailureMap({ 1: { ...failure, remedy: "resend_later" } })).toBe(false);
      expect(isSceneFailureMap({ 1: { ...failure, remedy: null } })).toBe(false);
    });

    it("still refuses the fields a screen states money from", () => {
      const { billedOnFailure: _gone, ...noBilling } = failure;
      expect(isSceneFailureMap({ 1: noBilling })).toBe(false);
      expect(isSceneFailureMap({ 1: { ...failure, billedOnFailure: "yes" } })).toBe(false);
      expect(isSceneFailureMap({ 1: { ...failure, category: "" } })).toBe(false);
      expect(isSceneFailureMap({ 0: failure })).toBe(false);
    });
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
