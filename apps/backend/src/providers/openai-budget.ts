import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";

export const STORY_ESTIMATED_COST_USD = 0.05;
export const IMAGE_ESTIMATED_COST_USD = 0.10;
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

  constructor(learningDataRoot: string, private readonly monthlyLimitUsd: number = DEFAULT_MONTHLY_LIMIT_USD) {
    this.filePath = path.join(learningDataRoot, "api_budget_usage.json");
  }

  private async load(): Promise<UsageRecord[]> {
    let text: string;
    try { text = await fs.readFile(this.filePath, "utf8"); } catch { return []; }
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter(isUsageRecord) : [];
    } catch { return []; }
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

export class OpenAiBudgetExceededError extends Error {
  constructor(public readonly estimatedCostUsd: number, public readonly remainingUsd: number) {
    super(`월 API 예산을 초과하여 요청을 보내지 않았습니다. 예상 비용 $${estimatedCostUsd.toFixed(2)}, 남은 예산 $${remainingUsd.toFixed(2)}`);
  }
}
