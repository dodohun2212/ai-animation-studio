/**
 * How much this computer may spend on one provider in a calendar month.
 *
 * $10 each, and it used to exist in exactly one form: a constant, passed by nobody. Every module that builds a
 * budget took the default, no setting reached it, and nothing read the environment — so a person who spent
 * their $10 had no way to continue. The refusal is correct and the wall behind it was not: the only ways past
 * it were to wait for the calendar month, or to edit the ledger, which is the one thing `load()`'s own doc
 * comment says destroys the record of what was spent.
 *
 * Three places can now say it, in this order, and they are deliberately the same knob rather than three:
 *
 *   1. a value saved from the settings screen, which is a line in the app's own `.env`
 *   2. `OPENAI_MONTHLY_BUDGET_USD` / `RUNWAY_MONTHLY_BUDGET_USD` in the environment the app was launched with
 *   3. $10
 *
 * The stored value wins over the environment because it is the more recent, more deliberate statement: someone
 * typed it into this app, in this app's own units, and expects the screen they typed it on to be telling the
 * truth afterwards. An environment variable is how the same number is set on a machine nobody is sitting at.
 */

const DEFAULT_MONTHLY_LIMIT_USD = 10;

/** Reads the limit from one stored/environment string. Exported for the parsing rules below, which are the point. */
export function parseMonthlyLimit(raw: string | null | undefined, fallbackUsd: number): number {
  if (raw === undefined || raw === null || raw.trim() === "") return fallbackUsd;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackUsd;
  return parsed;
}

/**
 * Anything that is not a positive finite number is ignored and the smaller number stands.
 *
 * A typo must never be able to widen a spending limit, and the only value that is safe to be wrong with is the
 * lower one. `0` is rejected rather than honoured: "spend nothing" is what removing the provider key already
 * says, and a zero read out of a malformed line is indistinguishable from an exhausted budget — the person
 * would see the refusal they see when they have genuinely run out, and go looking for spending they never did.
 */
export function monthlyLimitFromEnvironment(variableName: string, defaultLimitUsd = DEFAULT_MONTHLY_LIMIT_USD, environment: NodeJS.ProcessEnv = process.env): number {
  return parseMonthlyLimit(environment[variableName], defaultLimitUsd);
}

/** What a budget consults each time it is asked, so a limit saved on the settings screen applies to the next request and not the next launch. */
export interface MonthlyLimitStore {
  readNamed(name: string): Promise<string | null>;
}

export async function resolveMonthlyLimit(variableName: string, store: MonthlyLimitStore | undefined, environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  const fromEnvironment = monthlyLimitFromEnvironment(variableName, DEFAULT_MONTHLY_LIMIT_USD, environment);
  if (!store) return fromEnvironment;
  // A settings file that cannot be read is not a limit of zero and not a licence to spend the default either —
  // it is this function failing to find out. Falling back to the environment (and through it to $10) keeps the
  // app usable and never widens anything, which is the same direction every other rule in this file takes.
  const stored = await store.readNamed(variableName).catch(() => null);
  return parseMonthlyLimit(stored, fromEnvironment);
}

export { DEFAULT_MONTHLY_LIMIT_USD };
