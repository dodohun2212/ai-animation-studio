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

/** The single code both sides agree on, from the contract. The frontend keeps the sentence; the server only
 * ever sends this string — and the English one below, which five error factories used to spell out each. */
export { BUDGET_LEDGER_UNREADABLE_CODE } from "@ai-animation-studio/shared";
export const BUDGET_LEDGER_UNREADABLE_MESSAGE = "Monthly spend could not be read, so no paid request was sent.";

/**
 * Writes down money that is already gone, and never destroys what it bought.
 *
 * Every `budget.record` call in this codebase runs *after* a provider has been paid — the story came back, the
 * image bytes are in hand, the task finished. The spend is a fact whether or not the ledger write lands, so a
 * throw here takes the paid result with it. Measured on the Runway side (docs/06_DECISIONS.md D-037): a
 * finished, billed video was re-downloaded and re-discarded every five seconds while the screen said the job
 * was still generating. On the OpenAI side the same shape is worse in one way — most of these calls sit in a
 * `finally`, which discards the paid result on success *and* replaces the provider's real error on failure, so
 * a rejected prompt was about to be reported as a ledger problem.
 *
 * Returns true when the spend went unrecorded, so the caller can say so rather than lose the fact quietly. That
 * silence is the opposite mistake and just as costly: the month's total runs short and nobody is told.
 *
 * Nothing new is bought on the strength of this. `preflight` reads the same ledger and still refuses (D-036);
 * this only decides what happens to work already done.
 */
export async function recordSpend(record: () => Promise<void>): Promise<boolean> {
  try { await record(); return false; } catch { return true; }
}

/**
 * The one sentence for "it is here, and the ledger does not know what it cost".
 *
 * Written once because it has to say the same thing everywhere, and because the useful half is the instruction:
 * **do not make it again.** Regenerating is the single action that makes this worse — it buys the same thing
 * twice and leaves the month short by two — and it is exactly what a person reaches for when a screen mentions
 * a problem. The file is named because that is the only thing they can actually act on.
 */
export const spendUnrecordedWarning = (subject: string, ledgerFile: string) =>
  `${subject} 비용을 사용 기록(${ledgerFile})에 적지 못했습니다. 만들어진 것은 그대로 있고, 이번 달 사용액 합계만 실제보다 적게 잡혀 있습니다. 다시 만들지 마시고 기록 파일을 확인해 주세요.`;

/** The two ledger file names, so a warning never has to spell one out from memory. */
export const OPENAI_LEDGER_FILE = "api_budget_usage.json";
export const RUNWAY_LEDGER_FILE = "runway_budget_usage.json";
