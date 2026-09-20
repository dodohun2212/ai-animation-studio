import * as fs from "node:fs/promises";
import * as path from "node:path";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isOnBudgetDay } from "../providers/budget-month.js";

/**
 * How many summary calls the news reel may make in one local day.
 *
 * 🔴 **Not an estimate of use — an alarm.** 캡틴D makes one reel a day (Round 926), which costs one summary
 * call when it goes well and three or four when the checker refuses an article and they try another. Ten is
 * therefore not "about what we'll use": it is the number above which **something is wrong** — a retry loop, or
 * a checker refusing over and over, which is itself worth knowing.
 *
 * 🔴 **Why a count at all, when the calls are free.** The provider's free tier costs nothing, so the money
 * budget has nothing to weigh and will never refuse. But a key with billing attached silently becomes a paid
 * key the moment a free quota runs out, and nothing in this app can check whether billing is attached — that
 * is a promise, not a mechanism (Cowork Round 925 §2.3). So rather than trying to verify the promise, this
 * bounds what breaking it can cost: our gate closes well before theirs, and a runaway stops here.
 *
 * The number lives above the provider's own limit being unknown on purpose. 캡틴D reads their console; ours is
 * set below whatever it says, and this file never records a number they did not confirm.
 *
 * 🟢 **10 → 30, on 2026-09-20, and the reason is a fact 캡틴D stated rather than a guess.** Asked directly,
 * they confirmed: 「결제 방법을 아직 설정 안했긴해」. With no billing method on the project there is no
 * mechanism by which this key can be charged — the thing the low number was bounding cannot happen today.
 *
 * 🔴 **So this number is conditional, and the condition is written here because it will change.** The moment
 * billing is attached to that project the old reasoning returns in full and this should go back down. It is
 * not a limit anybody outgrew; it is a bound on a risk that is currently absent.
 *
 * 🟠 Why 30 and not "off": the count still catches the thing it was really for. Today alone it caught two
 * wrong model names and a provider outage burning calls — a runaway retry loop looks exactly like that, and
 * 30 stops one within a day while leaving room to actually make a few reels and fail a few times.
 */
export const NEWS_SUMMARY_DAILY_CALL_LIMIT = 30;

export class NewsDailyQuotaExceededError extends Error {
  constructor(readonly used: number, readonly limit: number) {
    super(`News summary daily call limit reached: ${used}/${limit}.`);
    this.name = "NewsDailyQuotaExceededError";
  }
}

export class NewsQuotaLedgerUnreadableError extends Error {
  constructor() {
    super("The news call ledger could not be read.");
    this.name = "NewsQuotaLedgerUnreadableError";
  }
}

interface NewsCallRecord {
  timestamp: string;
  /** Which paid-capable call this was. One kind today; named so a second one cannot silently share the count. */
  api_type: "news_summary";
  succeeded: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNewsCallRecord = (value: unknown): value is NewsCallRecord =>
  isObject(value) && typeof value.timestamp === "string" && value.api_type === "news_summary" && typeof value.succeeded === "boolean";

/**
 * The news reel's own call ledger — counts, not money.
 *
 * 🔴 **Its own file, deliberately, and this corrects what I said in Round 926.** I wrote that no new ledger was
 * needed because `OpenAiBudget.record(..., 0)` already appends a row at zero cost, and Cowork called that the
 * design's biggest saving. It is true that it *works*; it is not the right place. `api_budget_usage.json` is
 * described in its own header as OpenAI's spend, kept apart from Runway's so two providers' money is never
 * combined — and this counts **a different provider, in a different unit, over a different window**
 * (calls/day against dollars/month). Two units in one file makes the file stop answering "what am I" cleanly,
 * and the next person to sum a column gets a number that means nothing. Possible and right are different, which
 * is the distinction this repository spent the day making about everything else.
 *
 * 🟠 **What is shared is the rule, not the storage**: `isOnBudgetDay` sits beside `isInBudgetMonth` in one file,
 * because those two really are the same rule at two sizes.
 */
export class NewsCallQuota {
  private readonly filePath: string;

  constructor(learningDataRoot: string, private readonly dailyLimit: number = NEWS_SUMMARY_DAILY_CALL_LIMIT) {
    this.filePath = path.join(learningDataRoot, "news_call_usage.json");
  }

  /**
   * ENOENT is an honest first run and answers zero. Anything else throws, exactly as the money ledger does and
   * for the same reason (D-036): a count we cannot read is not a count of zero, and treating it as zero is the
   * single most permissive answer available directly underneath the call this cap exists to bound.
   */
  private async load(): Promise<NewsCallRecord[]> {
    let text: string;
    try { text = await fs.readFile(this.filePath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new NewsQuotaLedgerUnreadableError();
    }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new NewsQuotaLedgerUnreadableError(); }
    if (!Array.isArray(parsed)) throw new NewsQuotaLedgerUnreadableError();
    return parsed.filter(isNewsCallRecord);
  }

  /**
   * Calls made today, succeeded or not.
   *
   * 🔴 A failed call counts. It reached the provider, it consumed whatever quota they count, and a cap that
   * only counted successes would let a failing loop run forever — which is the exact shape this is here to
   * stop. The money ledger books failed attempts for the same reason.
   */
  async usedToday(now = new Date()): Promise<number> {
    const records = await this.load();
    return records.filter((record) => isOnBudgetDay(record.timestamp, now)).length;
  }

  async remainingToday(now = new Date()): Promise<number> {
    return Math.max(0, this.dailyLimit - await this.usedToday(now));
  }

  async limit(): Promise<number> {
    return this.dailyLimit;
  }

  /** Throws BEFORE the call goes out when today's allowance is already spent. */
  async preflight(now = new Date()): Promise<void> {
    const used = await this.usedToday(now);
    if (used >= this.dailyLimit) throw new NewsDailyQuotaExceededError(used, this.dailyLimit);
  }

  /**
   * Books one call.
   *
   * 🔴 Called only where a summary is actually requested. Picking a different photo must never reach this — it
   * is a Pexels request against a separate allowance, and a screen that spends the daily count on "different
   * photo, please" would burn the day on a button nobody thought cost anything (Cowork Round 927 §4). The two
   * paths stay apart here rather than in the screen, because a screen drawn correctly over one shared endpoint
   * still spends the count.
   */
  async record(succeeded: boolean, now = new Date()): Promise<void> {
    const records = await this.load();
    records.push({ timestamp: now.toISOString(), api_type: "news_summary", succeeded });
    await fs.mkdir(path.dirname(this.filePath), { recursive: true }).catch(() => undefined);
    await atomicWriteUtf8File(this.filePath, JSON.stringify(records, null, 2));
  }
}
