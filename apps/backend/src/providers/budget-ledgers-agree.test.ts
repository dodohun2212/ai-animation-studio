import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isBudgetLedgerUnreadable } from "./budget-ledger.js";
import { OpenAiBudget, OpenAiBudgetExceededError } from "./openai-budget.js";
import { RunwayBudget, RunwayBudgetExceededError } from "./runway-budget.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const LIMIT = 10;
const row = (timestamp: string, actualCostUsd: number, succeeded = true) => ({
  timestamp, project_id: "p", api_type: "t", estimated_cost_usd: actualCostUsd, actual_cost_usd: actualCostUsd, succeeded,
});

/** The same rows, in each ledger's own file, under one limit. */
async function bothWith(rows: unknown[]): Promise<{ openai: OpenAiBudget; runway: RunwayBudget }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ledgers-agree-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "api_budget_usage.json"), JSON.stringify(rows));
  await fs.writeFile(path.join(root, "runway_budget_usage.json"), JSON.stringify(rows));
  return { openai: new OpenAiBudget(root, LIMIT), runway: new RunwayBudget(root, LIMIT) };
}

/**
 * Two ledgers, one meaning of "spent this month".
 *
 * `spentThisMonth`, `remaining` and `preflight` are written out once per provider, identically. They are not
 * kept apart on purpose — the files are separate because OpenAI and Runway spend must never be combined, but
 * the arithmetic over them is one rule.
 *
 * There is an incident behind this rather than a worry: the month boundary was once computed in UTC while
 * people live in a local month, and that had to be corrected in both. Which month a row falls in is already
 * held for both by budget-month.test.ts; everything else the two compute over that month was not held for
 * either, and that is what is here.
 *
 * A divergence would show up as one provider refusing work the other would allow on the same day, with each
 * screen able to cite its own ledger.
 */
describe("the two spend ledgers answer the same question the same way", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");

  it("counts a failed attempt as spent, on both sides", async () => {
    // This provider charges for failures, and the ledger records the amount rather than the outcome. If only
    // one side stopped counting them, the same failed run would leave one budget short and the other whole.
    const { openai, runway } = await bothWith([row("2026-09-02T00:00:00.000Z", 3, false)]);
    expect(await openai.spentThisMonth(now)).toBe(3);
    expect(await runway.spentThisMonth(now)).toBe(3);
  });

  it("refuses at the same boundary, to the cent", async () => {
    // The number that decides whether a paid request is sent. Exactly the remainder goes; a cent past it does
    // not — and both must draw that line in the same place or one provider's screen is quoting a limit the
    // other's preflight does not honour.
    const { openai, runway } = await bothWith([row("2026-09-03T00:00:00.000Z", 9.5)]);
    expect(await openai.remaining(now)).toBe(await runway.remaining(now));
    await expect(openai.preflight(0.5, now)).resolves.toBeUndefined();
    await expect(runway.preflight(0.5, now)).resolves.toBeUndefined();
    await expect(openai.preflight(0.51, now)).rejects.toBeInstanceOf(OpenAiBudgetExceededError);
    await expect(runway.preflight(0.51, now)).rejects.toBeInstanceOf(RunwayBudgetExceededError);
  });

  it("never reports a negative remainder, however far past the limit a month went", async () => {
    // Clamped rather than negative: a negative remainder printed on a screen reads as credit.
    const { openai, runway } = await bothWith([row("2026-09-04T00:00:00.000Z", 25)]);
    expect(await openai.remaining(now)).toBe(0);
    expect(await runway.remaining(now)).toBe(0);
  });

  it("refuses to answer at all when the ledger cannot be read, on both sides", async () => {
    // The one posture that must not differ: while we cannot tell what has been spent, neither ledger may fall
    // back to zero. Their error classes differ; `isBudgetLedgerUnreadable` is what every caller reads.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ledgers-agree-bad-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "api_budget_usage.json"), "{ not json");
    await fs.writeFile(path.join(root, "runway_budget_usage.json"), "{ not json");
    for (const budget of [new OpenAiBudget(root, LIMIT), new RunwayBudget(root, LIMIT)]) {
      await expect(budget.spentThisMonth(now)).rejects.toSatisfy(isBudgetLedgerUnreadable);
    }
  });

  it("treats no ledger at all as an honest zero, on both sides", async () => {
    // A first run has spent nothing, and refusing there would refuse every first request on a new machine.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ledgers-agree-empty-"));
    roots.push(root);
    expect(await new OpenAiBudget(root, LIMIT).spentThisMonth(now)).toBe(0);
    expect(await new RunwayBudget(root, LIMIT).spentThisMonth(now)).toBe(0);
  });
});
