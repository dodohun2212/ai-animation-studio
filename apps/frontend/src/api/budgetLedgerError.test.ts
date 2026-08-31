import { describe, expect, it } from "vitest";

import { BUDGET_LEDGER_UNREADABLE, BUDGET_LEDGER_UNREADABLE_MESSAGE } from "./budgetLedgerError.js";
import { ImageGenerationApiError, toImageGenerationDisplayError } from "./imageGenerationApi.js";
import { ImageReviewApiError, toImageReviewDisplayError } from "./imageReviewApi.js";
import { LongProjectsApiError, toLongProjectDisplayError, episodeSceneErrorMessage } from "./longProjectsApi.js";
import { NarrationApiError, toNarrationDisplayError } from "./narrationApi.js";
import { StoryPromptApiError, toStoryDisplayError } from "./storyPromptApi.js";
import { VideoSubmissionApiError, toVideoSubmissionDisplayError } from "./videoSubmissionApi.js";
import { sceneErrorMessage } from "./videoWorkflowApi.js";

const GENERIC = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

describe("budget ledger unreadable", () => {
  // The label exists to keep one specific sentence off this refusal. An unreadable ledger stays unreadable
  // until a file is fixed, and the generic fallback tells the reader to wait and press again — advice that
  // cannot come true. So "it is mapped" is not the assertion; "it is not the generic one" is.
  it("gives every paid screen a reason instead of telling them to try again later", () => {
    const seen = [
      toLongProjectDisplayError(new LongProjectsApiError(BUDGET_LEDGER_UNREADABLE, "raw C:\\ledger")),
      toImageReviewDisplayError(new ImageReviewApiError(BUDGET_LEDGER_UNREADABLE, "raw C:\\ledger")),
      toImageGenerationDisplayError(new ImageGenerationApiError(BUDGET_LEDGER_UNREADABLE, "raw C:\\ledger")),
      toNarrationDisplayError(new NarrationApiError(BUDGET_LEDGER_UNREADABLE, "raw C:\\ledger")),
      toStoryDisplayError(new StoryPromptApiError(BUDGET_LEDGER_UNREADABLE, "raw C:\\ledger")),
      toVideoSubmissionDisplayError(new VideoSubmissionApiError(BUDGET_LEDGER_UNREADABLE, "raw C:\\ledger")),
    ];

    for (const display of seen) {
      expect(display.message).toBe(BUDGET_LEDGER_UNREADABLE_MESSAGE);
      expect(display.message).not.toBe(GENERIC);
      expect(display.message).not.toContain("ledger");
    }
  });

  // A scene that failed this way did not overspend — the ledger could not be read, so the amount spent is
  // unknown and nothing was sent. The reason next to it in the table (budget_exceeded) says money ran out,
  // which is a different thing to go fix, so the two must not collapse into one sentence.
  it("does not tell a failed scene that the budget ran out", () => {
    for (const message of [sceneErrorMessage("budget_ledger_unreadable"), episodeSceneErrorMessage("budget_ledger_unreadable")]) {
      expect(message).toBe(BUDGET_LEDGER_UNREADABLE_MESSAGE);
      expect(message).not.toBe(sceneErrorMessage("budget_exceeded"));
    }
  });

  // Both tables read the same constant, so they cannot drift apart as paid paths are added — this asserts the
  // property that arrangement is for, not the arrangement itself, and would still hold if the constant were
  // ever inlined back into both files.
  it("says the same thing on every screen that can spend money", () => {
    const long = toLongProjectDisplayError(new LongProjectsApiError(BUDGET_LEDGER_UNREADABLE, ""));
    const review = toImageReviewDisplayError(new ImageReviewApiError(BUDGET_LEDGER_UNREADABLE, ""));
    expect(long.message).toBe(review.message);
    expect(long.message).toBe(sceneErrorMessage("budget_ledger_unreadable"));
  });

  // The sentence a person acts on. Without it they press the button again; the file is still unreadable and
  // the second press refuses exactly like the first.
  it("says pressing again will not help", () => {
    expect(BUDGET_LEDGER_UNREADABLE_MESSAGE).toContain("다시 눌러도");
  });
});
