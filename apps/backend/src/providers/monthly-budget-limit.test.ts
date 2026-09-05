import { describe, expect, it } from "vitest";
import { OpenAiBudget } from "./openai-budget.js";
import { RunwayBudget } from "./runway-budget.js";
import { monthlyLimitFromEnvironment } from "./monthly-budget-limit.js";

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
  it("applies to both providers, each under its own variable", () => {
    const previous = { openai: process.env.OPENAI_MONTHLY_BUDGET_USD, runway: process.env.RUNWAY_MONTHLY_BUDGET_USD };
    try {
      process.env.OPENAI_MONTHLY_BUDGET_USD = "40";
      process.env.RUNWAY_MONTHLY_BUDGET_USD = "60";
      expect(new OpenAiBudget("/nowhere").monthlyLimitUsd).toBe(40);
      expect(new RunwayBudget("/nowhere").monthlyLimitUsd).toBe(60);

      delete process.env.OPENAI_MONTHLY_BUDGET_USD;
      delete process.env.RUNWAY_MONTHLY_BUDGET_USD;
      expect(new OpenAiBudget("/nowhere").monthlyLimitUsd, "the default does not move").toBe(10);
      expect(new RunwayBudget("/nowhere").monthlyLimitUsd, "the default does not move").toBe(10);
    } finally {
      if (previous.openai === undefined) delete process.env.OPENAI_MONTHLY_BUDGET_USD; else process.env.OPENAI_MONTHLY_BUDGET_USD = previous.openai;
      if (previous.runway === undefined) delete process.env.RUNWAY_MONTHLY_BUDGET_USD; else process.env.RUNWAY_MONTHLY_BUDGET_USD = previous.runway;
    }
  });

  /** An explicit argument still wins — the tests that pin budget behaviour pass their own limit. */
  it("still takes a limit passed directly, which is how the budget tests set one", () => {
    process.env.OPENAI_MONTHLY_BUDGET_USD = "99";
    try { expect(new OpenAiBudget("/nowhere", 3).monthlyLimitUsd).toBe(3); }
    finally { delete process.env.OPENAI_MONTHLY_BUDGET_USD; }
  });
});
