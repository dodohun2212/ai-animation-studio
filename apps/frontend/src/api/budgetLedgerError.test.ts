import { describe, expect, it } from "vitest";

import { BUDGET_LEDGER_UNREADABLE, BUDGET_LEDGER_UNREADABLE_MESSAGE } from "./budgetLedgerError.js";
import { ImageReviewApiError, toImageReviewDisplayError } from "./imageReviewApi.js";
import { LongProjectsApiError, toLongProjectDisplayError } from "./longProjectsApi.js";

const GENERIC = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

describe("budget ledger unreadable", () => {
  // The label exists to keep one specific sentence off this refusal. An unreadable ledger stays unreadable
  // until a file is fixed, and the generic fallback tells the reader to wait and press again — advice that
  // cannot come true. So "it is mapped" is not the assertion; "it is not the generic one" is.
  it("gives the paid screens a reason instead of telling them to try again later", () => {
    const long = toLongProjectDisplayError(new LongProjectsApiError(BUDGET_LEDGER_UNREADABLE, "raw C:\\ledger"));
    const review = toImageReviewDisplayError(new ImageReviewApiError(BUDGET_LEDGER_UNREADABLE, "raw C:\\ledger"));

    expect(long.message).toBe(BUDGET_LEDGER_UNREADABLE_MESSAGE);
    expect(review.message).toBe(BUDGET_LEDGER_UNREADABLE_MESSAGE);
    expect(long.message).not.toBe(GENERIC);
    expect(review.message).not.toBe(GENERIC);
    expect(long.message).not.toContain("ledger");
  });

  // Both tables read the same constant, so they cannot drift apart as paid paths are added — this asserts the
  // property that arrangement is for, not the arrangement itself, and would still hold if the constant were
  // ever inlined back into both files.
  it("says the same thing on every screen that can spend money", () => {
    const long = toLongProjectDisplayError(new LongProjectsApiError(BUDGET_LEDGER_UNREADABLE, ""));
    const review = toImageReviewDisplayError(new ImageReviewApiError(BUDGET_LEDGER_UNREADABLE, ""));
    expect(long.message).toBe(review.message);
  });

  // The sentence a person acts on. Without it they press the button again; the file is still unreadable and
  // the second press refuses exactly like the first.
  it("says pressing again will not help", () => {
    expect(BUDGET_LEDGER_UNREADABLE_MESSAGE).toContain("다시 눌러도");
  });
});
