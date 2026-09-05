/**
 * How much this computer may spend on one provider in a calendar month.
 *
 * $10 each, and until now that number existed in exactly one form: a constant, passed by nobody. Every module
 * that builds a budget uses the default, no setting reaches it, and no environment variable was read — so a
 * person who spends their $10 has no way to continue. The refusal is correct and the wall behind it was not:
 * the only ways past it were to wait for the calendar month, or to edit the ledger, which is the one thing
 * `load()`'s own doc comment says destroys the record of what was spent.
 *
 * So the number is now readable from the environment, the same way PROMPTS_ROOT and FONTS_ROOT are, and the
 * default does not move. Raising it is a decision about money, and this only makes the decision expressible;
 * whether it belongs on a settings screen is a product question, not this function's.
 *
 * Anything that is not a positive finite number is ignored and the default stands. That direction is
 * deliberate: a typo in an environment variable must never be able to widen a spending limit, and the only
 * value safe to fall back to is the smaller one. `0` is not accepted either — a limit of zero says "spend
 * nothing", which is what removing the provider key already does, and reading it out of a malformed variable
 * would look identical to the budget being exhausted.
 */
export function monthlyLimitFromEnvironment(variableName: string, defaultLimitUsd: number, environment: NodeJS.ProcessEnv = process.env): number {
  const raw = environment[variableName];
  if (raw === undefined || raw.trim() === "") return defaultLimitUsd;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimitUsd;
  return parsed;
}
