import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BudgetPreview } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";

const DEFAULT_MONTHLY_LIMIT_USD = 10;

interface UsageRecord {
  timestamp: string;
  project_id: string;
  api_type: string;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  succeeded: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isUsageRecord = (value: unknown): value is UsageRecord => isObject(value)
  && typeof value.timestamp === "string" && typeof value.api_type === "string" && typeof value.actual_cost_usd === "number";

/**
 * Local monthly OpenAI spend tracker, matching Python's `BudgetManager`: a conservative preflight estimate is
 * recorded as actual usage for both a succeeded and a failed provider attempt, so a failure can never silently
 * bypass budget accounting. Storage is `learning_data/api_budget_usage.json`, separate from Runway's own budget
 * file — OpenAI and Runway spend are never combined.
 */
export class OpenAiBudget {
  private readonly filePath: string;

  constructor(learningDataRoot: string, readonly monthlyLimitUsd: number = DEFAULT_MONTHLY_LIMIT_USD) {
    this.filePath = path.join(learningDataRoot, "api_budget_usage.json");
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
      throw new OpenAiBudgetLedgerUnreadableError();
    }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new OpenAiBudgetLedgerUnreadableError(); }
    if (!Array.isArray(parsed)) throw new OpenAiBudgetLedgerUnreadableError();
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
      throw new OpenAiBudgetExceededError(estimatedCostUsd, remaining);
    }
  }

  async record(projectId: string, apiType: string, succeeded: boolean, estimatedCostUsd: number, now = new Date()): Promise<void> {
    const records = await this.load();
    records.push({
      timestamp: now.toISOString(), project_id: projectId, api_type: apiType,
      estimated_cost_usd: estimatedCostUsd, actual_cost_usd: estimatedCostUsd, succeeded,
    });
    await fs.mkdir(path.dirname(this.filePath), { recursive: true }).catch(() => undefined);
    await atomicWriteUtf8File(this.filePath, JSON.stringify(records, null, 2));
  }
}

/** Read-only ledger snapshot for display — never reserves anything, same principle as RunwayBudget's equivalent (video preview/retry estimate) helpers. */
export async function budgetPreviewFor(budget: OpenAiBudget, estimatedCostUsd: number): Promise<BudgetPreview> {
  const [spentUsd, remainingUsd] = await Promise.all([budget.spentThisMonth(), budget.remaining()]);
  return { monthlyLimitUsd: budget.monthlyLimitUsd, spentUsd, remainingUsd, estimatedRequestCostUsd: estimatedCostUsd, canSpend: estimatedCostUsd <= remainingUsd };
}

export class OpenAiBudgetExceededError extends Error {
  constructor(public readonly estimatedCostUsd: number, public readonly remainingUsd: number) {
    super(`월 API 예산을 초과하여 요청을 보내지 않았습니다. 예상 비용 $${estimatedCostUsd.toFixed(2)}, 남은 예산 $${remainingUsd.toFixed(2)}`);
  }
}

/**
 * The spend ledger exists but cannot be read.
 *
 * Separate from the exceeded error because it means the opposite thing: not "you have spent too much" but "we
 * cannot tell what you have spent". Both refuse the request, and only one of them is the person's fault.
 */
export class OpenAiBudgetLedgerUnreadableError extends Error {
  constructor() {
    super("OpenAI 사용 기록(api_budget_usage.json)을 읽을 수 없어, 이번 달 사용액을 확인하지 못했습니다. 확인하기 전에는 유료 요청을 보내지 않습니다.");
  }
}
