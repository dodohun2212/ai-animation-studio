import { OpenAiBudgetLedgerUnreadableError } from "./openai-budget.js";
import { RunwayBudgetLedgerUnreadableError } from "./runway-budget.js";

/**
 * Whether a failure is "the spend ledger could not be read".
 *
 * Both budgets raise their own class for it, and every paid path has to tell that apart from an ordinary
 * storage failure: the two are the same shape on disk and mean opposite things to the person. One says the
 * write failed and waiting might help; this one says nothing knows what the month has cost, so no paid request
 * will be sent until a file is repaired — and pressing the button again cannot change that.
 *
 * Named here rather than checked inline in each caller because the answer must be the same in all of them. A
 * path that forgets the check does not fail loudly; it just tells the person to try again shortly, which is
 * the one thing that is certainly wrong (docs/06_DECISIONS.md D-036).
 */
export function isBudgetLedgerUnreadable(error: unknown): boolean {
  return error instanceof OpenAiBudgetLedgerUnreadableError || error instanceof RunwayBudgetLedgerUnreadableError;
}

/** The single code both sides agree on. The frontend keeps the sentence; the server only ever sends this string. */
export const BUDGET_LEDGER_UNREADABLE_CODE = "BUDGET_LEDGER_UNREADABLE";
