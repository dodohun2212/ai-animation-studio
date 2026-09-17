import { describe, expect, it } from "vitest";
import { assertNewsSummaryCheck } from "@ai-animation-studio/shared";

import { checkNewsSummary } from "./news-claim-check.js";

const ARTICLE = [
  "9월 14일 오전 9시부터 시청 앞 도로가 통제된다. 통제는 4시간 동안 이어지며, 우회로는 2개가 마련된다.",
  "시 관계자는 「우회로를 미리 안내하겠다」고 말했다. 지난해 같은 행사에는 4,000명이 모였다.",
  "행사는 2026년 9월 14일 하루만 열린다.",
].join("\n");

const texts = (claims: readonly { text: string }[]): string[] => claims.map((claim) => claim.text);

describe("news claim check", () => {
  it("passes a summary whose figures, dates and quotation are all in the article", () => {
    const check = checkNewsSummary(
      "9월 14일 시청 앞 도로가 4시간 통제된다. 관계자는 「우회로를 미리 안내하겠다」고 말했다.",
      ARTICLE,
    );
    expect(check.missing).toEqual([]);
    expect(check.claims.length).toBeGreaterThan(0);
  });

  /**
   * 🔴 The failure this whole feature exists to stop. The article says 4,000; the summary says 12,000 with a
   * confident air. Nothing else in the sentence is wrong, which is exactly why a person would not catch it.
   */
  it("catches a figure the article never gave", () => {
    const check = checkNewsSummary("지난해 행사에는 12,000명이 모였다.", ARTICLE);
    expect(texts(check.missing)).toEqual(["12,000"]);
  });

  /** A quotation is the easiest thing to invent and the most damaging, so it must match word for word. */
  it("catches a quotation that was reworded, however small the change", () => {
    const check = checkNewsSummary("관계자는 「우회로를 미리 안내할 것」이라고 말했다.", ARTICLE);
    expect(texts(check.missing)).toEqual(["우회로를 미리 안내할 것"]);
  });

  it("catches a date that is not in the article", () => {
    const check = checkNewsSummary("행사는 9월 15일에 열린다.", ARTICLE);
    expect(texts(check.missing)).toEqual(["9월 15일"]);
  });

  /**
   * Grouping is typography, not a claim — refusing over a comma would be a refusal about how a number is typed.
   * This is the one normalisation, and it cannot turn one number into a different one.
   */
  it("treats 4000 and 4,000 as the same figure", () => {
    expect(checkNewsSummary("4000명이 모였다.", ARTICLE).missing).toEqual([]);
    expect(checkNewsSummary("4,000명이 모였다.", ARTICLE).missing).toEqual([]);
  });

  /**
   * 🔴 The normalisation that is deliberately absent. 「1만 2천」 may well mean the article's 12,000 — but an
   * expander deciding that is code that can turn an *invented* figure into a match, and that is the one
   * direction that must never happen. So this refuses and shows the person both numbers.
   */
  it("refuses a Korean-unit figure rather than guessing it into digits", () => {
    const check = checkNewsSummary("지난해 행사에는 4천 명이 모였다.", ARTICLE);
    expect(texts(check.missing)).toEqual(["4천"]);
  });

  /**
   * 🔴 The false pass this file most has to avoid, found by writing the pair above and watching it go green when
   * it should not have. Plain substring search passes `40` because the article says `4,000` and `4000` contains
   * `40` — an invented figure waved through because a bigger real one starts with the same digits. A number now
   * matches only where no digit runs up against it.
   */
  it("does not pass a figure just because a larger one starts with it", () => {
    expect(texts(checkNewsSummary("40명이 모였다.", ARTICLE).missing)).toEqual(["40"]);
    expect(texts(checkNewsSummary("400명이 모였다.", ARTICLE).missing)).toEqual(["400"]);
    // And the real one still passes, so the guard is not simply refusing everything.
    expect(checkNewsSummary("4,000명이 모였다.", ARTICLE).missing).toEqual([]);
  });

  /** A date is checked whole: `14` turning up somewhere says nothing about whether the 14th was in the article. */
  it("does not let a date pass because its digits appear separately", () => {
    const check = checkNewsSummary("행사는 2026년 4월 9일에 열린다.", "2026년에 열리며 4개 구역, 9개 부스가 선다.");
    expect(texts(check.missing)).toEqual(["2026년 4월 9일"]);
  });

  /** The longest date pattern wins, so a full date is one claim rather than a year plus a shorter date. */
  it("reads a full date as one claim, not as its parts", () => {
    const check = checkNewsSummary("행사는 2026년 9월 14일 하루만 열린다.", ARTICLE);
    expect(texts(check.claims)).toEqual(["2026년 9월 14일"]);
  });

  /** Saying the same figure twice is one claim about the world; two rows would read as two separate failures. */
  it("reports a repeated span once", () => {
    const check = checkNewsSummary("12,000명이 모였다. 정말 12,000명이다.", ARTICLE);
    expect(texts(check.missing)).toEqual(["12,000"]);
  });

  /** Empty quote marks are punctuation. A claim with no text would be a pass nobody earned. */
  it("ignores empty quote marks", () => {
    const check = checkNewsSummary("관계자는 「」라고 말했다.", ARTICLE);
    expect(check.claims).toEqual([]);
  });

  /**
   * 🟠 "checked nine, missed none" and "checked none" are different facts, and a screen that only sees the
   * missing count cannot tell them apart — a summary with no figures at all is not a verified summary.
   */
  it("says it checked nothing, rather than saying nothing was wrong", () => {
    const check = checkNewsSummary("도로가 통제된다.", ARTICLE);
    expect(check.claims).toEqual([]);
    expect(check.missing).toEqual([]);
  });

  /** Whatever this returns has to satisfy the contract's own rule, or the client refuses it as malformed. */
  it("always returns a check the contract accepts", () => {
    for (const summary of [
      "9월 14일 4시간 통제된다.",
      "12,000명이 모였고 「가짜 인용」이라고 했다.",
      "특별한 내용이 없다.",
      "「우회로를 미리 안내하겠다」",
    ]) {
      expect(() => assertNewsSummaryCheck(checkNewsSummary(summary, ARTICLE))).not.toThrow();
    }
  });
});
