/**
 * Whether a ledger entry belongs to the month the budget is currently counting.
 *
 * Both budgets used to compare `timestamp.startsWith(now.toISOString().slice(0, 7))` — the UTC month — while
 * the ledger is a monthly allowance for one person on one computer, and their month is the local one. Nine
 * hours of every Korean month fell on the wrong side of that: KST 10-01 00:00 is UTC 09-30 15:00, so spend on
 * the first morning of October still counted against September, and September's exhausted budget kept
 * refusing work until 09:00. Somebody watching midnight pass and the wall stay up has no way to read that as
 * anything but the app being broken.
 *
 * The rule lives here rather than twice, once per budget class, because two copies of the same money rule are
 * two chances to fix only one of them.
 *
 * An unparseable timestamp counts toward no month, which is what the string comparison did as well — so this
 * change moves no other line. It is the permissive direction and deliberately unchanged here: a corrupt row
 * that counted toward every month would refuse all spending forever, and the ledger being unreadable already
 * has its own refusal (see each budget's `load`).
 */
export function isInBudgetMonth(timestamp: string, now: Date): boolean {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return false;
  return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
}
