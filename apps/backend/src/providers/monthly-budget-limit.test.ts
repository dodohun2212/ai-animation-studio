import { describe, expect, it } from "vitest";
import { OpenAiBudget } from "./openai-budget.js";
import { RunwayBudget } from "./runway-budget.js";
import { monthlyLimitFromEnvironment, resolveMonthlyLimit } from "./monthly-budget-limit.js";

describe("monthly budget limit", () => {
  /**
   * The wall behind the refusal.
   *
   * $10 was a constant nobody passed. Every module builds its budget with the default, no setting reaches it,
   * and nothing read the environment — so somebody who spends their $10 waits for the calendar month or edits
   * the ledger, and editing the ledger is exactly what destroys the record of what was spent.
   */
  it("reads the limit from the environment, so spending one is not a dead end", () => {
    expect(monthlyLimitFromEnvironment("LIMIT", 10, { LIMIT: "25" })).toBe(25);
    expect(monthlyLimitFromEnvironment("LIMIT", 10, { LIMIT: "2.5" }), "lowering it works the same way").toBe(2.5);
  });

  /**
   * A typo must never widen a spending limit.
   *
   * Every rejected value falls back to the smaller number, which is the only direction that is safe to be
   * wrong in. `0` is rejected rather than honoured: "spend nothing" is what removing the provider key already
   * says, and a zero read out of a malformed variable is indistinguishable from an exhausted budget.
   */
  it("ignores anything that is not a positive number, and keeps the default", () => {
    for (const value of ["", "   ", "abc", "-5", "0", "NaN", "1e999", "10,000"]) {
      expect(monthlyLimitFromEnvironment("LIMIT", 10, { LIMIT: value }), `"${value}" must not change the limit`).toBe(10);
    }
    expect(monthlyLimitFromEnvironment("LIMIT", 10, {})).toBe(10);
  });

  /**
   * Both ledgers, or neither. They are separate budgets on purpose — OpenAI and Runway spend are never
   * combined — and a person who can raise one and not the other hits the same wall from the other side.
   */
  it("applies to both providers, each under its own variable", async () => {
    const previous = { openai: process.env.OPENAI_MONTHLY_BUDGET_USD, runway: process.env.RUNWAY_MONTHLY_BUDGET_USD };
    try {
      process.env.OPENAI_MONTHLY_BUDGET_USD = "40";
      process.env.RUNWAY_MONTHLY_BUDGET_USD = "60";
      expect(await new OpenAiBudget("/nowhere").monthlyLimit()).toBe(40);
      expect(await new RunwayBudget("/nowhere").monthlyLimit()).toBe(60);

      delete process.env.OPENAI_MONTHLY_BUDGET_USD;
      delete process.env.RUNWAY_MONTHLY_BUDGET_USD;
      expect(await new OpenAiBudget("/nowhere").monthlyLimit(), "the default does not move").toBe(10);
      expect(await new RunwayBudget("/nowhere").monthlyLimit(), "the default does not move").toBe(10);
    } finally {
      if (previous.openai === undefined) delete process.env.OPENAI_MONTHLY_BUDGET_USD; else process.env.OPENAI_MONTHLY_BUDGET_USD = previous.openai;
      if (previous.runway === undefined) delete process.env.RUNWAY_MONTHLY_BUDGET_USD; else process.env.RUNWAY_MONTHLY_BUDGET_USD = previous.runway;
    }
  });

  /** An explicit argument still wins — the tests that pin budget behaviour pass their own limit. */
  it("still takes a limit passed directly, which is how the budget tests set one", async () => {
    process.env.OPENAI_MONTHLY_BUDGET_USD = "99";
    try { expect(await new OpenAiBudget("/nowhere", 3).monthlyLimit()).toBe(3); }
    finally { delete process.env.OPENAI_MONTHLY_BUDGET_USD; }
  });

  /**
   * A number typed into this app outranks one the app was launched with.
   *
   * Both are the same knob under the same name — the settings screen writes the line into the app's own .env.
   * The saved one wins because it is the more recent, more deliberate statement: somebody typed it here and
   * expects the screen they typed it on to be telling them the truth afterwards.
   */
  it("prefers a saved limit over the launch environment, and looks it up per question", async () => {
    let saved: string | null = "30";
    const store = { readNamed: async () => saved };

    expect(await resolveMonthlyLimit("LIMIT", store, { LIMIT: "12" })).toBe(30);

    saved = null;
    expect(await resolveMonthlyLimit("LIMIT", store, { LIMIT: "12" }), "nothing saved falls through to the environment").toBe(12);
    expect(await resolveMonthlyLimit("LIMIT", store, {}), "and through that to the default").toBe(10);

    saved = "not a number";
    expect(await resolveMonthlyLimit("LIMIT", store, { LIMIT: "12" }), "a broken saved line must not widen anything either").toBe(12);
  });

  /**
   * A settings file that will not read is not a limit of zero, and not a licence to spend the default either —
   * it is this lookup failing to find out. Falling through never widens, which is the direction every rule in
   * this file takes; refusing outright would take the whole app down over a number that has a good default.
   */
  it("falls back to the environment when the settings file cannot be read", async () => {
    const store = { readNamed: async () => { throw new Error("unreadable"); } };
    expect(await resolveMonthlyLimit("LIMIT", store, { LIMIT: "7" })).toBe(7);
    expect(await resolveMonthlyLimit("LIMIT", store, {})).toBe(10);
  });
});
