import { describe, expect, it } from "vitest";

import { NEWS_REEL_TEXT_BOXES, NEWS_REEL_TEXT_FIELDS, type NewsReelCard } from "./api.js";
import { HANGUL_WIDTH_RATIO, checkNewsReelCardText, countNewsReelText, newsReelCardGeometry, newsReelTextBox } from "./news-reel-card.js";

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

  /** 🔴 The screen reads the limit from the contract rather than keeping its own copy (docs/06_DECISIONS.md D-053). */
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

describe("news reel card geometry", () => {
  const g = (captionLines: 1 | 2 = 2) => newsReelCardGeometry(1080, 1920, captionLines);

  /**
   * 🔴 이 계약이 「15자」라고 말하면 화면은 **15자가 꼭 맞는 크기**여야 한다. 96 을 손으로 적으면 한도가 13이
   * 된 날 글자는 그대로고 줄만 헐거워지며, 그 어긋남은 **릴이 하나 나온 뒤에** 보인다.
   */
  it("sizes the letters so a full line is exactly as wide as the space it has", () => {
    const { headlineSize, captionSize, usableWidth } = g();
    const widthOf = (limit: number, size: number) => limit * size * HANGUL_WIDTH_RATIO;

    expect(widthOf(NEWS_REEL_TEXT_BOXES["headline.line1"].limit, headlineSize)).toBeLessThanOrEqual(usableWidth);
    expect(widthOf(NEWS_REEL_TEXT_BOXES["headline.line1"].limit + 1, headlineSize), "한 자 더는 안 들어갑니다").toBeGreaterThan(usableWidth);
    expect(widthOf(NEWS_REEL_TEXT_BOXES["caption.line1"].limit, captionSize)).toBeLessThanOrEqual(usableWidth);
    expect(widthOf(NEWS_REEL_TEXT_BOXES["caption.line1"].limit + 1, captionSize)).toBeGreaterThan(usableWidth);
  });

  /** 🟠 제목이 자막보다 커야 한다 — 제목은 낚고 자막은 설명한다. 한도가 좁을수록 글자가 커지므로 저절로 그렇다. */
  it("makes the headline bigger than the caption, because the narrower box gets the bigger letters", () => {
    expect(g().headlineSize).toBeGreaterThan(g().captionSize);
  });

  /**
   * 🔴 릴스는 아래쪽을 자기 자막·버튼으로 덮는다 — 포토카드 슬라이더가 0.85 위에서 경고하는 그 자리다.
   * 자막 띠가 거기 걸리면 **구워 놓고 안 보인다.**
   */
  it("keeps the caption band above the line Instagram covers", () => {
    for (const lines of [1, 2] as const) {
      const { captionBandY, captionBandHeight } = g(lines);
      expect(captionBandY + captionBandHeight, `${lines}줄`).toBeLessThanOrEqual(Math.round(1920 * 0.84));
    }
  });

  /** 🔴 겹치면 둘 다 못 읽는다. 이건 고른 값이 아니라 **지켜야 하는 것**이라 짝이 든다. */
  it("never lets the bands and the lines touch each other", () => {
    for (const lines of [1, 2] as const) {
      const geometry = g(lines);
      const { bandHeight, headlineSize, headline1Y, headline2Y, captionBandY, captionSize, caption1Y, caption2Y } = geometry;
      expect(headline1Y - headlineSize / 2, "제목 첫 줄이 띠 밑에 있습니다").toBeGreaterThan(bandHeight);
      expect(headline2Y - headlineSize / 2, "두 줄이 안 겹칩니다").toBeGreaterThan(headline1Y + headlineSize / 2 - 1);
      expect(headline2Y + headlineSize / 2, "제목이 자막 띠를 안 침범합니다").toBeLessThan(captionBandY);
      expect(caption1Y - captionSize / 2, "자막이 띠 안에 있습니다").toBeGreaterThanOrEqual(captionBandY);
      if (lines === 2) {
        expect(caption2Y + captionSize / 2).toBeLessThanOrEqual(captionBandY + geometry.captionBandHeight);
      }
    }
  });

  /** 🟠 한 줄짜리 자막은 띠도 얇다 — 안 쓰는 줄만큼 그림을 덜 가린다. */
  it("gives a one-line caption a shorter band", () => {
    expect(g(1).captionBandHeight).toBeLessThan(g(2).captionBandHeight);
  });

  /** 🟠 세로가 아니어도 답이 나와야 한다 — 1:1 도 4:5 도 이미 계약에 있다. */
  it("answers for a square frame too, without anything leaving it", () => {
    const square = newsReelCardGeometry(1080, 1080, 2);
    expect(square.captionBandY + square.captionBandHeight).toBeLessThanOrEqual(Math.round(1080 * 0.84));
    expect(square.headline2Y + square.headlineSize / 2).toBeLessThan(square.captionBandY);
    expect(square.margin * 2 + square.usableWidth).toBe(1080);
  });
});
