import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isInBudgetMonth } from "./budget-month.js";
import { OpenAiBudget } from "./openai-budget.js";
import { RunwayBudget } from "./runway-budget.js";

const previousTimezone = process.env.TZ;
let root: string | undefined;
afterEach(async () => {
  if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

/** The person's own month — this app is used from Korea, nine hours ahead of the timestamps it writes. */
function inSeoul<T>(body: () => T): T {
  process.env.TZ = "Asia/Seoul";
  return body();
}

async function ledgerWith(fileName: string, timestamp: string, cost: number): Promise<string> {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "budget-month-"));
  await fs.writeFile(path.join(root, fileName), JSON.stringify([
    { timestamp, project_id: "p", api_type: "image", estimated_cost_usd: cost, actual_cost_usd: cost, succeeded: true },
  ]), "utf8");
  return root;
}

describe("which month a spend belongs to", () => {
  /**
   * The nine hours every Korean month started in the wrong one.
   *
   * `startsWith(now.toISOString().slice(0, 7))` compared UTC months against a budget that is a monthly
   * allowance for one person on one computer. KST 10-01 00:30 is written as 2026-09-30T15:30Z, so it counted
   * against September — and September's exhausted budget went on refusing until 09:00 on October the first.
   * Watching midnight pass with the wall still up reads as the app being broken, and there is nothing on
   * screen that could explain it.
   */
  it("counts a spend in the first hours of the local month as that month's", () => {
    inSeoul(() => {
      const firstMorning = new Date("2026-09-30T15:30:00.000Z"); // KST 2026-10-01 00:30
      const laterThatDay = new Date("2026-10-01T03:00:00.000Z"); // KST 2026-10-01 12:00

      expect(isInBudgetMonth(firstMorning.toISOString(), laterThatDay)).toBe(true);
      expect(firstMorning.toISOString().slice(0, 7), "and the UTC month it used to be filed under").toBe("2026-09");
    });
  });

  it("still keeps last month's spend out of this month's total", () => {
    inSeoul(() => {
      const september = new Date("2026-09-30T14:00:00.000Z"); // KST 2026-09-30 23:00
      const october = new Date("2026-10-01T03:00:00.000Z");
      expect(isInBudgetMonth(september.toISOString(), october)).toBe(false);
      expect(isInBudgetMonth(september.toISOString(), september)).toBe(true);
    });
  });

  it("counts a row with an unreadable timestamp toward no month, so one corrupt row cannot refuse every request", () => {
    expect(isInBudgetMonth("not a date", new Date())).toBe(false);
    expect(isInBudgetMonth("", new Date())).toBe(false);
  });

  /** Both ledgers read the same rule — they are separate budgets, not separate calendars. */
  it("applies to the OpenAI and Runway ledgers alike", async () => {
    process.env.TZ = "Asia/Seoul";
    const now = new Date("2026-10-01T03:00:00.000Z"); // KST 2026-10-01 12:00
    const firstMorning = "2026-09-30T15:30:00.000Z"; // KST 2026-10-01 00:30

    const openAiRoot = await ledgerWith("api_budget_usage.json", firstMorning, 1.25);
    expect(await new OpenAiBudget(openAiRoot).spentThisMonth(now)).toBe(1.25);
    await fs.rm(openAiRoot, { recursive: true, force: true });

    const runwayRoot = await ledgerWith("runway_budget_usage.json", firstMorning, 2.5);
    expect(await new RunwayBudget(runwayRoot).spentThisMonth(now)).toBe(2.5);
  });
});
