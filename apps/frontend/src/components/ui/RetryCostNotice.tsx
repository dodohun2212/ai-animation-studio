import type { BudgetPreview } from "@ai-animation-studio/shared";

interface RetryCostNoticeProps {
  /**
   * From a progress response's `retryEstimate`. Absent in the local fake mode — and also, since CLI Rounds
   * 397/400, on a real paid job whose budget ledger could not be read. So absent means "no number to show",
   * never "nothing is being charged"; nothing here may treat it as proof of the second.
   */
  estimate: { perSceneCostUsd: number; budget: BudgetPreview } | undefined;
  /** How many scenes this action would regenerate — 1 for a single retry, N for "regenerate all". */
  sceneCount: number;
  "data-testid"?: string;
}

/**
 * The cost line shown inside a retry / regenerate confirmation, before anything is submitted.
 *
 * The product spec requires a failed scene's retry to "show the additional cost again" before approval, and the
 * design system requires the estimated cost and the remaining budget to appear together on any screen that
 * spends money. `perSceneCostUsd` is multiplied here rather than server-side because how many scenes are being
 * retried is a UI choice the progress response cannot know in advance.
 *
 * Renders nothing when there is no estimate. That is right for both reasons the field can be absent (a fake
 * adapter that charges nothing, or a real job whose ledger could not be read): in neither case is there an
 * honest number, and inventing one would be worse than showing none. What must not happen is a caller reading
 * this component's silence as "free" — see the props doc above.
 */
export function RetryCostNotice({ estimate, sceneCount, "data-testid": testId }: RetryCostNoticeProps) {
  if (!estimate) return null;
  const total = estimate.perSceneCostUsd * sceneCount;
  const overBudget = total > estimate.budget.remainingUsd || !estimate.budget.canSpend;
  return (
    <div data-testid={testId} className="space-y-1">
      <p className="text-xs text-slate-300 tabular-nums">
        추가 예상 비용: ${total.toFixed(2)}
        {sceneCount > 1 ? ` (${sceneCount}장면 × $${estimate.perSceneCostUsd.toFixed(2)})` : ""}
      </p>
      <p className="text-xs text-slate-400 tabular-nums">
        이번 달 남은 예산: ${estimate.budget.remainingUsd.toFixed(2)} (월 한도 ${estimate.budget.monthlyLimitUsd.toFixed(2)} 중 $
        {estimate.budget.spentUsd.toFixed(2)} 사용)
      </p>
      {overBudget && (
        <p role="alert" className="text-xs font-semibold text-rose-300">
          이번 요청의 예상 비용이 남은 월 예산을 초과합니다. 그대로 진행하면 예산 한도에 막혀 실패할 수 있습니다.
        </p>
      )}
    </div>
  );
}
