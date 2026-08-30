import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STORY_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";
import { OpenAiBudget, OpenAiBudgetExceededError, OpenAiBudgetLedgerUnreadableError } from "./openai-budget.js";

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

  it("reloads persisted usage across separate instances, and reads a missing ledger as nothing spent", async () => {
    const root = await makeRoot();
    await new OpenAiBudget(root, 10).record("p1", "story", true, 1, new Date("2026-08-22T00:00:00.000Z"));
    expect(await new OpenAiBudget(root, 10).spentThisMonth(new Date("2026-08-22T00:00:00.000Z"))).toBe(1);
  });

  /**
   * A ledger that cannot be read is not a ledger that says zero.
   *
   * It used to be: every failure came back as an empty list, and empty here means "nothing spent this month" —
   * the most permissive answer this file can give, sitting directly under a paid provider call. Measured with
   * $10 of a $10 budget already spent: corrupting the file let a $9.50 request through, and the next record()
   * rewrote the month's twenty entries as one. The budget reopened and the evidence went with it, silently.
   *
   * The assertion this replaces said only "tolerates a malformed usage file", with no reason given anywhere for
   * why tolerating it was safe. Refusing to spend while we cannot tell what has been spent is the direction the
   * product rules already take everywhere else (docs/06_DECISIONS.md D-036).
   *
   * The pair matters: a missing ledger must still read as zero, or a first run could never spend anything.
   */
  it("refuses rather than reporting zero when the ledger cannot be read, and leaves the bytes alone", async () => {
    const root = await makeRoot();
    await new OpenAiBudget(root, 10).record("p1", "story", true, 1, new Date("2026-08-22T00:00:00.000Z"));
    const file = path.join(root, "api_budget_usage.json");
    await fs.writeFile(file, "{not valid json", "utf8");

    await expect(new OpenAiBudget(root, 10).spentThisMonth()).rejects.toBeInstanceOf(OpenAiBudgetLedgerUnreadableError);
    await expect(new OpenAiBudget(root, 10).preflight(0.01)).rejects.toBeInstanceOf(OpenAiBudgetLedgerUnreadableError);
    await expect(new OpenAiBudget(root, 10).record("p1", "story", true, 1, new Date("2026-08-22T00:00:00.000Z"))).rejects.toBeInstanceOf(OpenAiBudgetLedgerUnreadableError);
    expect(await fs.readFile(file, "utf8")).toBe("{not valid json");
  });
});
