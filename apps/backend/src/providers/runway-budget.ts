import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { monthlyLimitFromEnvironment } from "./monthly-budget-limit.js";

const DEFAULT_MONTHLY_LIMIT_USD = 10;
/** See monthly-budget-limit.ts: the default is unchanged, and it is now possible to say otherwise. */
const RUNWAY_MONTHLY_LIMIT_VARIABLE = "RUNWAY_MONTHLY_BUDGET_USD";

interface UsageRecord {
  timestamp: string;
  project_id: string;
  /** Absent on records written before per-scene tracking existed; such legacy records still count toward the monthly total but are excluded from {@link RunwayBudget.costsByScene}. */
  scene_number?: number;
  api_type: string;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  succeeded: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isUsageRecord = (value: unknown): value is UsageRecord => isObject(value)
  && typeof value.timestamp === "string" && typeof value.api_type === "string" && typeof value.actual_cost_usd === "number"
  && (value.scene_number === undefined || typeof value.scene_number === "number");

/**
 * Local monthly Runway spend tracker, mirroring OpenAiBudget's shape: a conservative preflight estimate is
 * recorded as actual usage for both a succeeded and a failed provider attempt, so a failure can never silently
 * bypass budget accounting. Storage is `learning_data/runway_budget_usage.json`, separate from OpenAI's own
 * budget file — Runway and OpenAI spend are never combined. Shared by both the short-project and long-form
 * Episode video pipelines (one ledger per computer, matching how OpenAiBudget is shared by Story and Image).
 */
export class RunwayBudget {
  private readonly filePath: string;

  constructor(learningDataRoot: string, readonly monthlyLimitUsd: number = monthlyLimitFromEnvironment(RUNWAY_MONTHLY_LIMIT_VARIABLE, DEFAULT_MONTHLY_LIMIT_USD)) {
    this.filePath = path.join(learningDataRoot, "runway_budget_usage.json");
  }

  /**
   * The ledger, or an empty one only when there is genuinely no ledger yet.
   *
   * Every failure used to come back as `[]`, and `[]` here means "nothing spent this month" — the single most
   * permissive answer this file can give, sitting directly under a paid provider call. Measured before the fix:
   * with $10 of a $10 budget already spent, corrupting this file let a $9.50 request through, and the first
   * `record()` afterwards rewrote the month's twenty entries as one. The budget reopened and the evidence went
   * with it, in silence.
   *
   * ENOENT still returns `[]` — no file is the honest first run. Anything else throws, and that is the whole
   * point of docs/06_DECISIONS.md D-036's third question: a value this permissive, with paid work running on
   * top of it, is never something to fall back to. Refusing to spend while we cannot tell what has been spent
   * is the only safe direction.
   *
   * 🟠 `record()` throws too, and that is deliberate. It would otherwise have to load, fail, and write anyway —
   * which is exactly the overwrite that destroyed the history. A throw leaves the bytes on disk for whoever
   * comes to look at them.
   */
  private async load(): Promise<UsageRecord[]> {
    let text: string;
    try { text = await fs.readFile(this.filePath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new RunwayBudgetLedgerUnreadableError();
    }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new RunwayBudgetLedgerUnreadableError(); }
    if (!Array.isArray(parsed)) throw new RunwayBudgetLedgerUnreadableError();
    return parsed.filter(isUsageRecord);
  }

  private currentMonth(now: Date): string {
    return now.toISOString().slice(0, 7);
  }

  async spentThisMonth(now = new Date()): Promise<number> {
    const month = this.currentMonth(now);
    const records = await this.load();
    return records.filter((record) => record.timestamp.startsWith(month)).reduce((sum, record) => sum + record.actual_cost_usd, 0);
  }

  async remaining(now = new Date()): Promise<number> {
    return Math.max(0, this.monthlyLimitUsd - (await this.spentThisMonth(now)));
  }

  /** Throws BEFORE any request is sent when the estimate would exceed the remaining monthly budget. */
  async preflight(estimatedCostUsd: number, now = new Date()): Promise<void> {
    const remaining = await this.remaining(now);
    if (estimatedCostUsd > remaining) {
      throw new RunwayBudgetExceededError(estimatedCostUsd, remaining);
    }
  }

  /**
   * `actualCostUsd` defaults to the estimate (every existing caller relies on this): once a task has actually
   * started, Runway may have done paid work even on a failure, so the conservative estimate stands in for the
   * real (unknowable to us) cost. It must be passed explicitly as 0 for a submission Runway rejected outright
   * (a 4xx before any task existed) — nothing was ever run, so nothing was ever billed, and recording the
   * estimate there let repeated submission failures (e.g. an exhausted Runway credit balance) eat the monthly budget for calls Runway never actually charged.
   */
  async record(projectId: string, sceneNumber: number, apiType: string, succeeded: boolean, estimatedCostUsd: number, now = new Date(), actualCostUsd: number = estimatedCostUsd): Promise<void> {
    const records = await this.load();
    records.push({
      timestamp: now.toISOString(), project_id: projectId, scene_number: sceneNumber, api_type: apiType,
      estimated_cost_usd: estimatedCostUsd, actual_cost_usd: actualCostUsd, succeeded,
    });
    await fs.mkdir(path.dirname(this.filePath), { recursive: true }).catch(() => undefined);
    await atomicWriteUtf8File(this.filePath, JSON.stringify(records, null, 2));
  }

  /** Sums actually-recorded cost per scene for one project, across every attempt (including past regenerations) and regardless of month — a review screen's "how much has this scene cost so far", not a monthly figure. */
  async costsByScene(projectId: string): Promise<Partial<Record<number, number>>> {
    // Display only, and after the fact — nothing is bought on the strength of this number, so an unreadable
    // ledger costs the review screen a column rather than closing it. `spentThisMonth` deliberately does the
    // opposite: that one is read to decide whether to spend (D-036's third question — what runs on top of it).
    let records: UsageRecord[];
    try { records = await this.load(); } catch (error) { if (error instanceof RunwayBudgetLedgerUnreadableError) return {}; throw error; }
    const result: Partial<Record<number, number>> = {};
    for (const record of records) {
      if (record.project_id !== projectId || record.scene_number === undefined) continue;
      result[record.scene_number] = (result[record.scene_number] ?? 0) + record.actual_cost_usd;
    }
    return result;
  }
}

export class RunwayBudgetExceededError extends Error {
  constructor(public readonly estimatedCostUsd: number, public readonly remainingUsd: number) {
    super(`월 Runway 예산을 초과하여 요청을 보내지 않았습니다. 예상 비용 $${estimatedCostUsd.toFixed(2)}, 남은 예산 $${remainingUsd.toFixed(2)}`);
  }
}

/**
 * The spend ledger exists but cannot be read.
 *
 * Separate from the exceeded error because it means the opposite thing: not "you have spent too much" but "we
 * cannot tell what you have spent". Both refuse the request, and only one of them is the person's fault.
 */
export class RunwayBudgetLedgerUnreadableError extends Error {
  constructor() {
    super("Runway 사용 기록(runway_budget_usage.json)을 읽을 수 없어, 이번 달 사용액을 확인하지 못했습니다. 확인하기 전에는 유료 요청을 보내지 않습니다.");
  }
}
