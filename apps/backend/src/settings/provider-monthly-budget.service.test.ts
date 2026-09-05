import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpenAiBudget } from "../providers/openai-budget.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { ProviderSettingsException } from "./provider-settings.error.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";
import { ProviderSettingsService } from "./provider-settings.service.js";
import { videoSceneEstimatedCostUsd } from "@ai-animation-studio/shared";

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

describe("which video model this computer uses", () => {
  let root: string;
  let service: ProviderSettingsService;
  const previous = process.env.VIDEO_MODEL;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "video-model-"));
    delete process.env.VIDEO_MODEL;
    service = new ProviderSettingsService(new ProviderSettingsRepository(root));
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.VIDEO_MODEL; else process.env.VIDEO_MODEL = previous;
    await fs.rm(root, { recursive: true, force: true });
  });

  /**
   * The capability Captain D asked for: not a change of model, a way to change it later.
   *
   * Stored in the same .env as the monthly limits and read per question, so a choice applies to the next quote
   * rather than the next launch — the posture that turned out to matter for the budget.
   */
  it("reports the default until somebody chooses, and remembers a choice", async () => {
    const before = await service.videoModelSetting();
    expect(before).toMatchObject({ selected: "gen4_turbo", isDefault: true });
    expect(before.options.map((option) => option.id), "and offers what it can price").toContain("gen4_turbo");

    const saved = await service.saveVideoModel({ model: "gen4_turbo" });
    expect(saved.videoModel.isDefault, "chosen is a different fact from defaulted").toBe(false);
    expect((await service.getSettings()).videoModel.selected).toBe("gen4_turbo");
  });

  /**
   * A model this app cannot price must never reach a budget check.
   *
   * Every quote and preflight multiplies that rate; accepting a name with no price would either divide by
   * nothing or quietly reuse the previous model's, and quoting money low is the one direction this must never
   * be wrong in.
   */
  it("refuses a model it has no price for, rather than defaulting quietly", async () => {
    for (const model of ["gen4.5", "", null, 7, "GEN4_TURBO"]) {
      await expect(service.saveVideoModel({ model }), `${String(model)} must not be storable`)
        .rejects.toBeInstanceOf(ProviderSettingsException);
    }
    await expect(service.saveVideoModel({ model: "gen4_turbo", andMore: true })).rejects.toBeInstanceOf(ProviderSettingsException);
    expect((await service.videoModelSetting()).isDefault, "nothing was written by any of those").toBe(true);
  });

  /**
   * Every offered model carries a price a quote is computed from.
   *
   * 🟠 With one priced model this cannot yet catch the arithmetic going wrong: that model's rate and the
   * module-level per-second constant are the same number, so replacing one with the other changes nothing and
   * an injection here stays green. Said plainly rather than dressed up — it guards the shape today and becomes
   * load-bearing the moment a second model is listed, which is the point at which the two can disagree.
   */
  it("prices what it offers, so a picker can show what changes", async () => {
    for (const option of (await service.videoModelSetting()).options) {
      expect(videoSceneEstimatedCostUsd(5, option.id), `${option.id} at five seconds`).toBeCloseTo(option.pricePerSecondUsd * 5, 10);
    }
  });
});
