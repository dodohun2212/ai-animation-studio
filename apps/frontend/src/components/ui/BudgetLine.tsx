import type { BudgetPreview } from "@ai-animation-studio/shared";

interface BudgetLineProps {
  /** The ledger snapshot from a response; absent in the local fake execution mode, where nothing is charged. */
  budget: BudgetPreview | undefined;
  /**
   * What this screen is about to spend, when it is known before the request goes out (e.g. scene count times the
   * per-image estimate). Omit to show only the ledger state.
   */
  estimatedRequestCostUsd?: number;
  /** Optional breakdown shown next to the estimate, e.g. "6장 × $0.10". */
  breakdown?: string;
  "data-testid"?: string;
}

/**
 * The "what this costs and what is left" line for any screen that spends OpenAI or Runway budget.
 *
 * The design system requires the estimated cost and the remaining monthly budget to appear together wherever
 * money is spent, and the product spec requires the cost to be visible before approval rather than after. This
 * mirrors {@link RetryCostNotice} — that one is for a retry confirmation, this one for the ongoing state of a
 * screen — so the two read identically wherever they sit next to each other.
 *
 * Renders nothing without a budget: an absent ledger means the local fake adapter, and inventing a zero there
 * would read as "this is free" on a screen that may well not be.
 */
export function BudgetLine({ budget, estimatedRequestCostUsd, breakdown, "data-testid": testId }: BudgetLineProps) {
  if (!budget) return null;
  const overBudget =
    estimatedRequestCostUsd === undefined ? !budget.canSpend : estimatedRequestCostUsd > budget.remainingUsd || !budget.canSpend;
  return (
    <div data-testid={testId} className="space-y-1">
      {estimatedRequestCostUsd !== undefined && (
        <p className="text-xs text-slate-300 tabular-nums">
          예상 비용: ${estimatedRequestCostUsd.toFixed(2)}
          {breakdown ? ` (${breakdown})` : ""}
        </p>
      )}
      <p className="text-xs text-slate-400 tabular-nums">
        이번 달 남은 예산: ${budget.remainingUsd.toFixed(2)} (월 한도 ${budget.monthlyLimitUsd.toFixed(2)} 중 $
        {budget.spentUsd.toFixed(2)} 사용)
      </p>
      {overBudget && (
        <p role="alert" className="text-xs font-semibold text-rose-300">
          남은 월 예산이 부족합니다. 그대로 진행하면 예산 한도에 막혀 실패할 수 있습니다.
        </p>
      )}
    </div>
  );
}
