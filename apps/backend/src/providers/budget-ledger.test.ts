import { describe, expect, it } from "vitest";

import { isBudgetLedgerUnreadable, OPENAI_LEDGER_FILE, RUNWAY_LEDGER_FILE, recordSpend, spendUnrecordedWarning } from "./budget-ledger.js";
import { OpenAiBudgetLedgerUnreadableError } from "./openai-budget.js";
import { RunwayBudgetLedgerUnreadableError } from "./runway-budget.js";

/**
 * Three small controls that decide what happens to work that has already been paid for.
 *
 * None of them had a test. They are each a few lines, which is exactly why: a three-line function reads as
 * obvious right up until someone tidies it, and both ways of tidying this one are documented incidents.
 * docs/06_DECISIONS.md D-037 — a finished, billed video re-downloaded and re-discarded every five seconds
 * because a ledger write threw and took the paid result with it; and on the OpenAI side the same call sits in a
 * `finally`, where a throw also replaces the provider's real error with a ledger one.
 */
describe("what happens to paid work when the ledger will not take it", () => {
  it("reports the write failed instead of throwing, so the thing that was bought survives", async () => {
    // The whole point: money is already gone when this runs. A throw here loses what it bought and tells the
    // person about a file instead of about their video.
    await expect(recordSpend(async () => { throw new Error("disk full"); })).resolves.toBe(true);
  });

  it("says nothing went unrecorded when the write lands", async () => {
    // false is not "no error" — it is the caller's answer to "must I warn about this?", and answering true on
    // the happy path would put a spend-unrecorded warning on every successful scene.
    await expect(recordSpend(async () => {})).resolves.toBe(false);
  });

  it("recognises both providers' unreadable ledgers, and nothing else", async () => {
    // Eleven catch sites choose the sentence a person reads from this one predicate. Missing one provider's
    // class sends that provider's unreadable ledger to a generic error, on that path only.
    expect(isBudgetLedgerUnreadable(new OpenAiBudgetLedgerUnreadableError())).toBe(true);
    expect(isBudgetLedgerUnreadable(new RunwayBudgetLedgerUnreadableError())).toBe(true);
    expect(isBudgetLedgerUnreadable(new Error("disk full"))).toBe(false);
    expect(isBudgetLedgerUnreadable(undefined)).toBe(false);
  });

  it("names the file and the thing, because those are the only parts anyone can act on", () => {
    // Deliberately not pinning the sentence. This repository has been bitten by a test that held the wording
    // while the fact underneath changed; what has to survive a rewrite is the ledger's filename and the subject.
    const message = spendUnrecordedWarning("3번 장면 이미지 생성", OPENAI_LEDGER_FILE);
    expect(message).toContain(OPENAI_LEDGER_FILE);
    expect(message).toContain("3번 장면 이미지 생성");
    expect(spendUnrecordedWarning("영상", RUNWAY_LEDGER_FILE)).toContain(RUNWAY_LEDGER_FILE);
  });

  it("keeps the two ledger filenames apart", () => {
    // A warning naming the wrong file sends someone to a file where the missing row was never going to be.
    expect(OPENAI_LEDGER_FILE).not.toBe(RUNWAY_LEDGER_FILE);
  });
});
