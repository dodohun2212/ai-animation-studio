import { describe, expect, it } from "vitest";

import { NEWS_REEL_TEXT_BOXES, NEWS_REEL_TEXT_FIELDS, type NewsReelCard } from "./api.js";
import { checkNewsReelCardText, countNewsReelText, newsReelTextBox } from "./news-reel-card.js";

const card = (over: Partial<NewsReelCard> = {}): NewsReelCard => ({
  publisher: "연합뉴스",
  headline: { line1: "국회 검찰청 폐지", line2: "후속 법률 통과" },
  caption: { line1: "여야 합의로 본회의를 통과했다", line2: null },
  creditRequired: false,
  ...over,
});

const refusals = (boxes: readonly { field: string; refusal: string | null }[]): string[] =>
  boxes.filter((box) => box.refusal !== null).map((box) => `${box.field}:${box.refusal}`);

describe("news reel text count", () => {
  it("counts a Hangul line by its syllables", () => {
    expect(countNewsReelText("국회 검찰청 폐지")).toBe(9);
  });

  /**
   * 🔴 `.length` counts a surrogate pair as two, which refuses an ordinary line for holding one character
   * stored in two halves. The count is about how wide the line draws, and that is per character.
   */
  it("counts a character stored in two halves once", () => {
    expect(countNewsReelText("𠀋")).toBe(1);
    expect("𠀋".length).toBe(2);
  });

  /** Trailing space is not ink — counting it would redden a line that fits. */
  it("does not count space at the ends", () => {
    expect(countNewsReelText("  국회  ")).toBe(2);
  });

  /** Over-counting refuses, and refusing is the safe direction. Doubled spaces inside are left alone. */
  it("counts a doubled space inside as written", () => {
    expect(countNewsReelText("국회  검찰")).toBe(6);
  });
});

describe("news reel text box", () => {
  it("says how many are left while a box is still short", () => {
    const box = newsReelTextBox("headline.line1", "국회 검찰청 폐지");
    expect(box).toMatchObject({ limit: 15, count: 9, remaining: 6, refusal: null });
  });

  it("takes a line exactly at the limit", () => {
    const box = newsReelTextBox("headline.line1", "검찰청폐지후속법률통과국회의결");
    expect(box).toMatchObject({ count: 15, remaining: 0, refusal: null });
  });

  /** 🔴 The whole point of the box: one past the limit is refused, and `remaining` says how far over. */
  it("refuses one character past the limit and says how far over", () => {
    const box = newsReelTextBox("headline.line1", "검찰청폐지후속법률통과국회의결안");
    expect(box).toMatchObject({ count: 16, remaining: -1, refusal: "too_long" });
  });

  it("refuses a required box that holds nothing", () => {
    expect(newsReelTextBox("headline.line2", null).refusal).toBe("missing");
    expect(newsReelTextBox("headline.line2", "   ").refusal).toBe("missing");
  });

  /**
   * 🔴 The distinction the whole contract is built on, in miniature: absent is a one-line caption and is
   * fine; the empty string cannot be told apart from "not written yet", so it is refused.
   */
  it("allows an absent second caption line but refuses an empty one", () => {
    expect(newsReelTextBox("caption.line2", null).refusal).toBeNull();
    expect(newsReelTextBox("caption.line2", "").refusal).toBe("blank");
    expect(newsReelTextBox("caption.line2", " ").refusal).toBe("blank");
  });

  /** 🔴 The screen reads the limit from the contract rather than keeping its own copy (Cowork Round 1028 §3). */
  it("carries the contract's own limit for every box", () => {
    for (const field of NEWS_REEL_TEXT_FIELDS) {
      expect(newsReelTextBox(field, "가").limit).toBe(NEWS_REEL_TEXT_BOXES[field].limit);
    }
  });
});

describe("news reel card text check", () => {
  it("looks at every box, not only the ones that failed", () => {
    const check = checkNewsReelCardText(card());
    expect(check.boxes.map((box) => box.field)).toEqual([...NEWS_REEL_TEXT_FIELDS]);
    expect(check.refused).toEqual([]);
  });

  it("names each box that cannot be used", () => {
    const check = checkNewsReelCardText(card({
      headline: { line1: "검찰청폐지후속법률통과국회의결안", line2: "" },
      caption: { line1: "여야 합의로 본회의를 통과했다고 밝혔다", line2: "" },
    }));
    expect(refusals(check.refused)).toEqual([
      "headline.line1:too_long",
      "headline.line2:missing",
      "caption.line1:too_long",
      "caption.line2:blank",
    ]);
  });

  /** `refused` is a convenience over `boxes` and must not be able to disagree with it. */
  it("keeps refused in agreement with boxes", () => {
    const check = checkNewsReelCardText(card({ caption: { line1: "여야 합의로 본회의를 통과했다고 한다", line2: "표결은 재적 과반으로 이뤄졌다" } }));
    expect(check.refused).toEqual(check.boxes.filter((box) => box.refusal !== null));
  });

  /**
   * 🔴 The third line is not left open, so there is nowhere for a third to go: a caption is two boxes, and
   * a contract that widens later can widen, while one that has already shipped three cannot narrow.
   */
  it("has room for two caption lines and no third", () => {
    expect(NEWS_REEL_TEXT_FIELDS.filter((field) => field.startsWith("caption."))).toEqual(["caption.line1", "caption.line2"]);
  });
});
