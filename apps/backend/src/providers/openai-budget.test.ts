import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STORY_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";
import { OpenAiBudget, OpenAiBudgetExceededError } from "./openai-budget.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const makeRoot = async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), "openai-budget-")); roots.push(root); return root; };

describe("OpenAiBudget", () => {
  it("starts with the full monthly limit available when no usage file exists", async () => {
    const root = await makeRoot();
    const budget = new OpenAiBudget(root, 10);
    expect(await budget.spentThisMonth()).toBe(0);
    expect(await budget.remaining()).toBe(10);
    await expect(budget.preflight(STORY_ESTIMATED_COST_USD)).resolves.toBeUndefined();
  });

  it("records estimated cost as actual cost for both a succeeded and a failed attempt", async () => {
    const root = await makeRoot();
    const budget = new OpenAiBudget(root, 10);
    const now = new Date("2026-08-22T00:00:00.000Z");
    await budget.record("p1", "story", true, 0.05, now);
    await budget.record("p1", "story", false, 0.05, now);
    expect(await budget.spentThisMonth(now)).toBeCloseTo(0.1, 8);
    expect(await budget.remaining(now)).toBeCloseTo(9.9, 8);
    const raw = JSON.parse(await fs.readFile(path.join(root, "api_budget_usage.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(raw).toHaveLength(2);
    expect(raw[0]).toMatchObject({ project_id: "p1", api_type: "story", estimated_cost_usd: 0.05, actual_cost_usd: 0.05, succeeded: true });
    expect(raw[1]).toMatchObject({ succeeded: false });
  });

  it("only counts usage from the current UTC month", async () => {
    const root = await makeRoot();
    const budget = new OpenAiBudget(root, 10);
    await budget.record("p1", "story", true, 5, new Date("2026-07-31T23:59:59.000Z"));
    await budget.record("p1", "story", true, 3, new Date("2026-08-01T00:00:00.000Z"));
    expect(await budget.spentThisMonth(new Date("2026-08-15T00:00:00.000Z"))).toBe(3);
  });

  it("throws OpenAiBudgetExceededError before any request when the estimate would exceed the remaining budget", async () => {
    const root = await makeRoot();
    const budget = new OpenAiBudget(root, 0.05);
    const now = new Date("2026-08-22T00:00:00.000Z");
    await budget.record("p1", "story", true, 0.05, now);
    await expect(budget.preflight(STORY_ESTIMATED_COST_USD, now)).rejects.toBeInstanceOf(OpenAiBudgetExceededError);
  });

  it("reloads persisted usage across separate instances and tolerates a malformed usage file", async () => {
    const root = await makeRoot();
    await new OpenAiBudget(root, 10).record("p1", "story", true, 1, new Date("2026-08-22T00:00:00.000Z"));
    expect(await new OpenAiBudget(root, 10).spentThisMonth(new Date("2026-08-22T00:00:00.000Z"))).toBe(1);

    await fs.writeFile(path.join(root, "api_budget_usage.json"), "{not valid json", "utf8");
    expect(await new OpenAiBudget(root, 10).spentThisMonth()).toBe(0);
  });
});
