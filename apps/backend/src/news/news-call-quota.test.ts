import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NEWS_SUMMARY_DAILY_CALL_LIMIT, NewsCallQuota, NewsDailyQuotaExceededError, NewsQuotaLedgerUnreadableError } from "./news-call-quota.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function newRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-quota-"));
  roots.push(root);
  return root;
}

const at = (iso: string) => new Date(iso);

describe("news call quota", () => {
  it("counts nothing on a first run, and lets the first call through", async () => {
    const quota = new NewsCallQuota(await newRoot());
    expect(await quota.usedToday()).toBe(0);
    await expect(quota.preflight()).resolves.toBeUndefined();
  });

  it("books calls and refuses once the day's allowance is gone", async () => {
    const quota = new NewsCallQuota(await newRoot(), 3);
    const now = at("2026-09-19T10:00:00+09:00");

    for (let call = 0; call < 3; call++) {
      await quota.preflight(now);
      await quota.record(true, now);
    }

    expect(await quota.usedToday(now)).toBe(3);
    expect(await quota.remainingToday(now)).toBe(0);
    await expect(quota.preflight(now)).rejects.toBeInstanceOf(NewsDailyQuotaExceededError);
  });

  /**
   * 🔴 A failed call still reached the provider and still consumed whatever they count. A cap that only counted
   * successes would let a failing retry loop run all day — the exact shape this exists to stop.
   */
  it("counts a failed call against the day", async () => {
    const quota = new NewsCallQuota(await newRoot(), 2);
    const now = at("2026-09-19T10:00:00+09:00");

    await quota.record(false, now);
    await quota.record(false, now);

    await expect(quota.preflight(now)).rejects.toBeInstanceOf(NewsDailyQuotaExceededError);
  });

  /**
   * 🔴 The reason `isOnBudgetDay` is local, and the same wall `isInBudgetMonth` was fixed for: a Korean user
   * watching their clock pass midnight must get their allowance back. Under a UTC day these two timestamps are
   * the same day (09-18 15:00Z and 09-19 00:59Z) and the cap would stay shut until 09:00.
   */
  it("gives the allowance back at the user's own midnight, not UTC's", async () => {
    const quota = new NewsCallQuota(await newRoot(), 1);
    const lateYesterday = at("2026-09-18T23:30:00+09:00");
    const justAfterMidnight = at("2026-09-19T00:30:00+09:00");

    await quota.record(true, lateYesterday);
    await expect(quota.preflight(lateYesterday)).rejects.toBeInstanceOf(NewsDailyQuotaExceededError);

    expect(await quota.usedToday(justAfterMidnight)).toBe(0);
    await expect(quota.preflight(justAfterMidnight)).resolves.toBeUndefined();
  });

  /**
   * 🔴 An unreadable ledger is not an empty one. Answering zero here would be the most permissive possible
   * answer sitting directly under the call this cap bounds — the same failure the money ledger was fixed for
   * (D-036), where corrupting the file let a $9.50 request through.
   */
  it("refuses rather than assuming zero when the ledger cannot be read", async () => {
    const root = await newRoot();
    await fs.writeFile(path.join(root, "news_call_usage.json"), "{ this is not json");
    const quota = new NewsCallQuota(root);

    await expect(quota.usedToday()).rejects.toBeInstanceOf(NewsQuotaLedgerUnreadableError);
    await expect(quota.preflight()).rejects.toBeInstanceOf(NewsQuotaLedgerUnreadableError);
    // And it does not rewrite the file it could not read — the bytes stay for whoever comes to look.
    await expect(quota.record(true)).rejects.toBeInstanceOf(NewsQuotaLedgerUnreadableError);
    expect(await fs.readFile(path.join(root, "news_call_usage.json"), "utf8")).toBe("{ this is not json");
  });

  /**
   * 🔴 The *other* unreadable case, and the one my first pair missed: a ledger that cannot be read **at all**,
   * rather than one holding bad JSON. A directory where the file should be makes `readFile` itself fail, which
   * is a different branch — and with only the bad-JSON pair above, replacing that branch's throw with `return []`
   * left all seven green. A guard whose own regression passes is not a guard.
   */
  it("refuses when the ledger cannot be opened at all, not only when its contents are bad", async () => {
    const root = await newRoot();
    // A directory in the ledger's place: readFile fails with EISDIR, never reaching JSON.parse.
    await fs.mkdir(path.join(root, "news_call_usage.json"));
    const quota = new NewsCallQuota(root);

    await expect(quota.usedToday()).rejects.toBeInstanceOf(NewsQuotaLedgerUnreadableError);
    await expect(quota.preflight()).rejects.toBeInstanceOf(NewsQuotaLedgerUnreadableError);
  });

  /**
   * 🟠 Its own file, not OpenAI's. That ledger is dollars-per-month for one provider; this is calls-per-day for
   * another, and a column summed across both would mean nothing (Round 928).
   */
  it("keeps its own ledger and never writes to the money one", async () => {
    const root = await newRoot();
    const quota = new NewsCallQuota(root);
    await quota.record(true);

    expect(await fs.readFile(path.join(root, "news_call_usage.json"), "utf8")).toContain("news_summary");
    await expect(fs.readFile(path.join(root, "api_budget_usage.json"), "utf8")).rejects.toThrow();
  });

  /**
   * The shipped number is the alarm 캡틴D's one-reel-a-day sits well under — not an estimate of use.
   *
   * 🔴 **A range, not the literal.** This used to read `toBe(10)`, which measured the number rather than the
   * claim above it: raising the limit for a stated reason (2026-09-20, no billing attached) broke a pair whose
   * own sentence says the exact value is not the point. What has to stay true is that one reel and its retries
   * fit comfortably, and that it is still an alarm — a limit nobody can reach is not one.
   */
  it("ships a limit that leaves room for a reel's retries", async () => {
    expect(NEWS_SUMMARY_DAILY_CALL_LIMIT, "한 편 만들고 몇 번 실패해도 되어야 합니다").toBeGreaterThanOrEqual(5);
    expect(NEWS_SUMMARY_DAILY_CALL_LIMIT, "닿을 수 없는 한도는 경보가 아닙니다").toBeLessThanOrEqual(50);
  });
});
