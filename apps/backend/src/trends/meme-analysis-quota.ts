import * as fs from "node:fs/promises";
import * as path from "node:path";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isOnBudgetDay } from "../providers/budget-month.js";

export const MEME_ANALYSIS_DAILY_LIMIT = 3;

/** Separate from news calls; a reservation is persisted before sending a Gemini request. */
export class MemeAnalysisQuota {
  readonly filename = "meme_analysis_call_usage.json";
  private readonly filePath: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(root: string, private readonly now: () => Date = () => new Date()) {
    this.filePath = path.join(root, this.filename);
  }

  private async read(): Promise<Array<{ timestamp: string }>> {
    let raw: string;
    try { raw = await fs.readFile(this.filePath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("ledger_unreadable");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("ledger_unreadable"); }
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "object" && item !== null && typeof item.timestamp === "string" && Number.isFinite(Date.parse(item.timestamp)))) {
      throw new Error("ledger_unreadable");
    }
    return parsed as Array<{ timestamp: string }>;
  }

  async dailyCalls(): Promise<{ used: number; limit: number }> {
    const now = this.now();
    return { used: (await this.read()).filter((row) => isOnBudgetDay(row.timestamp, now)).length, limit: MEME_ANALYSIS_DAILY_LIMIT };
  }

  async reserve(): Promise<{ used: number; limit: number }> {
    const before = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => { release = resolve; });
    await before;
    try {
      const now = this.now();
      const rows = await this.read();
      const used = rows.filter((row) => isOnBudgetDay(row.timestamp, now)).length;
      if (used >= MEME_ANALYSIS_DAILY_LIMIT) throw new Error("daily_limit");
      rows.push({ timestamp: now.toISOString() });
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await atomicWriteUtf8File(this.filePath, JSON.stringify(rows));
      } catch { throw new Error("ledger_unreadable"); }
      return { used: used + 1, limit: MEME_ANALYSIS_DAILY_LIMIT };
    } finally { release(); }
  }
}
