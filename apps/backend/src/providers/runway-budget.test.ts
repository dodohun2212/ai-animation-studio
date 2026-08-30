import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VIDEO_SCENE_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";
import { RunwayBudget, RunwayBudgetExceededError, RunwayBudgetLedgerUnreadableError } from "./runway-budget.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const makeRoot = async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), "runway-budget-")); roots.push(root); return root; };

describe("RunwayBudget", () => {
  it("starts with the full monthly limit available when no usage file exists", async () => {
    const root = await makeRoot();
    const budget = new RunwayBudget(root, 10);
    expect(await budget.spentThisMonth()).toBe(0);
    expect(await budget.remaining()).toBe(10);
    await expect(budget.preflight(VIDEO_SCENE_ESTIMATED_COST_USD)).resolves.toBeUndefined();
  });

  it("records estimated cost as actual cost for both a succeeded and a failed attempt, in its own file separate from OpenAI's", async () => {
    const root = await makeRoot();
    const budget = new RunwayBudget(root, 10);
    const now = new Date("2026-08-22T00:00:00.000Z");
    await budget.record("p1", 1, "video", true, 0.25, now);
    await budget.record("p1", 1, "video", false, 0.25, now);
    expect(await budget.spentThisMonth(now)).toBeCloseTo(0.5, 8);
    expect(await budget.remaining(now)).toBeCloseTo(9.5, 8);
    const raw = JSON.parse(await fs.readFile(path.join(root, "runway_budget_usage.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(raw).toHaveLength(2);
    expect(raw[0]).toMatchObject({ project_id: "p1", scene_number: 1, api_type: "video", estimated_cost_usd: 0.25, actual_cost_usd: 0.25, succeeded: true });
    expect(raw[1]).toMatchObject({ succeeded: false });
    await expect(fs.access(path.join(root, "api_budget_usage.json"))).rejects.toThrow();
  });

  it("records actual cost as 0 when told the submission was rejected outright, keeping the failure visible without spending monthly budget", async () => {
    const root = await makeRoot();
    const budget = new RunwayBudget(root, 10);
    const now = new Date("2026-08-22T00:00:00.000Z");
    await budget.record("p1", 1, "video", false, 0.25, now, 0);

    expect(await budget.spentThisMonth(now)).toBe(0);
    const raw = JSON.parse(await fs.readFile(path.join(root, "runway_budget_usage.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(raw).toEqual([expect.objectContaining({ project_id: "p1", scene_number: 1, estimated_cost_usd: 0.25, actual_cost_usd: 0, succeeded: false })]);
  });

  it("only counts usage from the current UTC month", async () => {
    const root = await makeRoot();
    const budget = new RunwayBudget(root, 10);
    await budget.record("p1", 1, "video", true, 5, new Date("2026-07-31T23:59:59.000Z"));
    await budget.record("p1", 1, "video", true, 3, new Date("2026-08-01T00:00:00.000Z"));
    expect(await budget.spentThisMonth(new Date("2026-08-15T00:00:00.000Z"))).toBe(3);
  });

  it("throws RunwayBudgetExceededError before any request when the estimate would exceed the remaining budget", async () => {
    const root = await makeRoot();
    const budget = new RunwayBudget(root, 0.25);
    const now = new Date("2026-08-22T00:00:00.000Z");
    await budget.record("p1", 1, "video", true, 0.25, now);
    await expect(budget.preflight(VIDEO_SCENE_ESTIMATED_COST_USD, now)).rejects.toBeInstanceOf(RunwayBudgetExceededError);
  });

  it("reloads persisted usage across separate instances, and reads a missing ledger as nothing spent", async () => {
    const root = await makeRoot();
    await new RunwayBudget(root, 10).record("p1", 1, "video", true, 1, new Date("2026-08-22T00:00:00.000Z"));
    expect(await new RunwayBudget(root, 10).spentThisMonth(new Date("2026-08-22T00:00:00.000Z"))).toBe(1);
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
    await new RunwayBudget(root, 10).record("p1", 1, "video", true, 1, new Date("2026-08-22T00:00:00.000Z"));
    const file = path.join(root, "runway_budget_usage.json");
    await fs.writeFile(file, "{not valid json", "utf8");

    await expect(new RunwayBudget(root, 10).spentThisMonth()).rejects.toBeInstanceOf(RunwayBudgetLedgerUnreadableError);
    await expect(new RunwayBudget(root, 10).preflight(0.01)).rejects.toBeInstanceOf(RunwayBudgetLedgerUnreadableError);
    await expect(new RunwayBudget(root, 10).record("p1", 1, "video", true, 1, new Date("2026-08-22T00:00:00.000Z"))).rejects.toBeInstanceOf(RunwayBudgetLedgerUnreadableError);
    expect(await fs.readFile(file, "utf8")).toBe("{not valid json");
  });

  it("sums actual cost per scene across regenerations regardless of month, ignoring other projects and legacy scene-less records", async () => {
    const root = await makeRoot();
    const budget = new RunwayBudget(root, 10);
    await budget.record("p1", 1, "video", false, 0.25, new Date("2026-07-15T00:00:00.000Z")); // failed attempt, still counted
    await budget.record("p1", 1, "video", true, 0.25, new Date("2026-08-15T00:00:00.000Z")); // regeneration a month later
    await budget.record("p1", 2, "video", true, 0.25, new Date("2026-08-15T00:00:00.000Z"));
    await budget.record("other-project", 1, "video", true, 9, new Date("2026-08-15T00:00:00.000Z"));
    const legacyRecordWithoutSceneNumber = { timestamp: "2026-06-01T00:00:00.000Z", project_id: "p1", api_type: "video", estimated_cost_usd: 1, actual_cost_usd: 1, succeeded: true };
    const existing = JSON.parse(await fs.readFile(path.join(root, "runway_budget_usage.json"), "utf8")) as unknown[];
    await fs.writeFile(path.join(root, "runway_budget_usage.json"), JSON.stringify([...existing, legacyRecordWithoutSceneNumber]), "utf8");

    expect(await budget.costsByScene("p1")).toEqual({ 1: 0.5, 2: 0.25 });
    expect(await budget.costsByScene("nonexistent-project")).toEqual({});
  });
});
