import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpenAiBudget } from "../providers/openai-budget.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { ProviderSettingsException } from "./provider-settings.error.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";
import { ProviderSettingsService } from "./provider-settings.service.js";

describe("the monthly spend limit, from the settings screen", () => {
  let root: string;
  let service: ProviderSettingsService;
  const previousEnvironment = { openai: process.env.OPENAI_MONTHLY_BUDGET_USD, runway: process.env.RUNWAY_MONTHLY_BUDGET_USD };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "provider-budget-"));
    delete process.env.OPENAI_MONTHLY_BUDGET_USD;
    delete process.env.RUNWAY_MONTHLY_BUDGET_USD;
    const repository = new ProviderSettingsRepository(root);
    service = new ProviderSettingsService(repository, {
      openai: new OpenAiBudget(root, undefined, repository),
      runway: new RunwayBudget(root, undefined, repository),
    });
  });
  afterEach(async () => {
    if (previousEnvironment.openai === undefined) delete process.env.OPENAI_MONTHLY_BUDGET_USD; else process.env.OPENAI_MONTHLY_BUDGET_USD = previousEnvironment.openai;
    if (previousEnvironment.runway === undefined) delete process.env.RUNWAY_MONTHLY_BUDGET_USD; else process.env.RUNWAY_MONTHLY_BUDGET_USD = previousEnvironment.runway;
    await fs.rm(root, { recursive: true, force: true });
  });

  /**
   * The number that stops a request is the number this screen shows.
   *
   * Saving writes the same line the budget reads, so there is no second copy to fall out of step, and the
   * spend comes from the ledger the refusal is computed from rather than a separate tally.
   */
  it("saves a limit that the budget itself then enforces, with no restart", async () => {
    const budget = new OpenAiBudget(root, undefined, new ProviderSettingsRepository(root));
    await budget.record("p1", "image", true, 9, new Date());
    await expect(budget.preflight(2), "$10 default, $9 spent — the request does not fit").rejects.toThrow();

    const saved = await service.saveMonthlyBudget("openai", { monthlyLimitUsd: 25 });
    expect(saved.budget).toMatchObject({ provider: "openai", monthlyLimitUsd: 25, isDefault: false, spentUsd: 9, remainingUsd: 16 });

    await expect(budget.preflight(2), "the same instance, no restart").resolves.toBeUndefined();
  });

  it("reports the default as a default, so a screen can tell 'my limit' from 'I never set one'", async () => {
    const before = await service.getSettings();
    expect(before.monthlyBudgets).toEqual([
      { provider: "openai", monthlyLimitUsd: 10, isDefault: true, spentUsd: 0, remainingUsd: 10 },
      { provider: "runway", monthlyLimitUsd: 10, isDefault: true, spentUsd: 0, remainingUsd: 10 },
    ]);

    await service.saveMonthlyBudget("runway", { monthlyLimitUsd: 40 });
    const after = await service.getSettings();
    expect(after.monthlyBudgets[0], "the other provider is untouched").toMatchObject({ provider: "openai", monthlyLimitUsd: 10, isDefault: true });
    expect(after.monthlyBudgets[1]).toMatchObject({ provider: "runway", monthlyLimitUsd: 40, isDefault: false });
  });

  /**
   * A number nobody typed must never become a spending limit.
   *
   * Zero is refused with the rest: "spend nothing" is what disconnecting the provider already says, and on
   * every screen that shows a budget a limit of zero is indistinguishable from one that has been used up.
   */
  it("refuses anything that is not a positive amount of money, and says which rule", async () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.005, "25", null]) {
      await expect(service.saveMonthlyBudget("openai", { monthlyLimitUsd: value }), `${String(value)} must not become a limit`)
        .rejects.toBeInstanceOf(ProviderSettingsException);
    }
    await expect(service.saveMonthlyBudget("openai", { monthlyLimitUsd: 25, andSomethingElse: true })).rejects.toBeInstanceOf(ProviderSettingsException);
    expect((await service.getSettings()).monthlyBudgets[0], "nothing was written by any of those").toMatchObject({ monthlyLimitUsd: 10, isDefault: true });
  });

  /** The credential in the same file is not disturbed by writing a limit next to it. */
  it("leaves the saved credential alone", async () => {
    await service.save("openai", { value: "sk-test-abcdefghijklmnopqrstuvwxyz" });
    await service.saveMonthlyBudget("openai", { monthlyLimitUsd: 30 });
    const settings = await service.getSettings();
    expect(settings.providers[0]).toMatchObject({ provider: "openai", configured: true, maskedValue: "sk-********wxyz" });
    expect(settings.monthlyBudgets[0]).toMatchObject({ monthlyLimitUsd: 30 });
  });

  /**
   * A ledger that will not read leaves the spend unknown, not zero.
   *
   * This screen has no business claiming nothing has been spent — that is the most permissive thing it could
   * say, next to a field for raising a spending limit. The limit itself is still true and still changeable.
   */
  it("says the spend is unavailable rather than reporting zero when the ledger is corrupt", async () => {
    await fs.writeFile(path.join(root, "api_budget_usage.json"), "{not json", "utf8");
    const settings = await service.getSettings();
    expect(settings.monthlyBudgets[0]).toMatchObject({ provider: "openai", monthlyLimitUsd: 10, spendUnavailable: true });
    expect(settings.monthlyBudgets[1], "the other ledger is fine and says so").not.toHaveProperty("spendUnavailable");
  });
});
