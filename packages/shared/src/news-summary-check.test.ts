import { describe, expect, it } from "vitest";
import { assertNewsSummaryCheck } from "./api.js";

import { NEWS_CHECK_SCOPE_NOTICE, checkNewsSummary } from "./news-summary-check.js";

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
    expect(texts(check.missing)).toEqual(["12,000명"]);
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
    expect(texts(check.missing)).toEqual(["4천 명"]);
  });

  /**
   * 🔴 The false pass this file most has to avoid, found by writing the pair above and watching it go green when
   * it should not have. Plain substring search passes `40` because the article says `4,000` and `4000` contains
   * `40` — an invented figure waved through because a bigger real one starts with the same digits. A number now
   * matches only where no digit runs up against it.
   */
  it("does not pass a figure just because a larger one starts with it", () => {
    expect(texts(checkNewsSummary("40명이 모였다.", ARTICLE).missing)).toEqual(["40명"]);
    expect(texts(checkNewsSummary("400명이 모였다.", ARTICLE).missing)).toEqual(["400명"]);
    // And the real one still passes, so the guard is not simply refusing everything.
    expect(checkNewsSummary("4,000명이 모였다.", ARTICLE).missing).toEqual([]);
  });

  /**
   * 🔴 The same false pass one character along, found by Cowork reading this file (Round 911). `3` sat inside
   * the article's `3.5`, so a summary that invented a bare 3 passed. The decimal point is a boundary too.
   */
  it("does not let a whole number pass on the strength of a decimal", () => {
    expect(texts(checkNewsSummary("3명이 왔다.", "3.5% 올랐다.").missing)).toEqual(["3명"]);
    expect(texts(checkNewsSummary("35명이 왔다.", "3.5% 올랐다.").missing)).toEqual(["35명"]);
  });

  /** `10월2일` and `10월 2일` are one date written twice — spaces come out of both sides before comparing. */
  it("reads a date the same with or without its spaces", () => {
    expect(checkNewsSummary("10월2일에 연다.", "10월 2일에 연다.").missing).toEqual([]);
    expect(checkNewsSummary("10월 2일에 연다.", "10월2일에 연다.").missing).toEqual([]);
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
    expect(texts(check.missing)).toEqual(["12,000명"]);
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

/**
 * Cowork's fixture and the three cases theirs held that this one did not (Round 911). Kept when the two checkers
 * merged: a case someone thought of is the expensive part, and dropping it to save a file is how the merge
 * would have cost more than the duplicate did.
 */
const ARTICLE_2 = [
  "국회는 2026년 9월 17일 검찰청 폐지에 따른 후속 법률 51건을 통과시켰다.",
  "개정법은 10월 2일부터 시행된다. 검사의 직접 수사권은 사법경찰로 넘어간다.",
  "납품대금 지급 기한은 직접 구매의 경우 60일에서 35일로 줄었다.",
  "야당은 \"시행 2주를 앞두고 한꺼번에 밀어붙이는 것을 개혁이라 할 수 있느냐\"고 비판했다.",
].join("\n");

describe("news claim check — the shapes a quotation and a unit can take", () => {
  /** Quotation marks are not meaning: 「」 and "" are one pair written two ways. */
  it("reads corner brackets and straight quotes as the same quotation", () => {
    const summary = "야당은 「시행 2주를 앞두고 한꺼번에 밀어붙이는 것을 개혁이라 할 수 있느냐」고 비판했다.";
    expect(checkNewsSummary(summary, ARTICLE_2).missing).toEqual([]);
  });

  /**
   * A counter is not part of the figure. The article says 51건 and the summary says 51개 — the number is the
   * same and it is there. Refusing this would redden correct summaries, and a check people stop believing is a
   * check that gets switched off.
   */
  it("does not refuse a figure because its counter was reworded", () => {
    expect(checkNewsSummary("법안 51개가 통과됐다.", ARTICLE_2).missing).toEqual([]);
  });

  /**
   * 🔴 The counter comes out of the *search* and stays in the *text*, and both halves matter. Cowork's screen
   * pair caught the second one: a refusal that names `53` when the person typed `53건` cannot be found in their
   * own summary, so the one actionable thing a refusal offers is gone.
   */
  it("shows the span as written while searching only for the figure", () => {
    const { missing } = checkNewsSummary("법안 53건이 통과됐다.", ARTICLE_2);
    expect(missing.map((claim) => claim.text)).toEqual(["53건"]);
  });

  /**
   * 🟠 The limit, pinned in code rather than only in a comment. `51` and `일` are both in the article, but never
   * joined — and this passes. That is why nothing may print 「확인됐습니다」 over a green result, and why the
   * contract has no `verified` field. Whoever reads this later should find the ceiling here, not infer one.
   */
  it("is a floor, not a guarantee: a real figure attached to the wrong thing still passes", () => {
    expect(checkNewsSummary("납품대금 지급 기한이 51일로 줄었다.", ARTICLE_2).missing).toEqual([]);
  });

  /**
   * 🔴 The sentence that has to sit beside the pair above, and it has gone missing once already — it lived in
   * `newsApi.ts`, went out with it in Round 910, and for a day the checker's own comment named a constant that
   * did not exist. A guard costs one assertion; the thing it prevents is a green result that reads as "this
   * summary is true" over a check that never looked at meaning.
   *
   * It is checked for what it *admits*, not for exact words — the wording may improve, but it stops being this
   * sentence if it no longer names what cannot be caught.
   */
  it("keeps a scope notice that says what the check cannot catch", () => {
    expect(NEWS_CHECK_SCOPE_NOTICE).toContain("숫자");
    expect(NEWS_CHECK_SCOPE_NOTICE).toContain("날짜");
    expect(NEWS_CHECK_SCOPE_NOTICE).toContain("인용");
    expect(NEWS_CHECK_SCOPE_NOTICE).toContain("못 잡습니다");
  });
});

describe("what a check is a statement about", () => {
  const ARTICLE = "통계청은 3.2%라고 밝혔다. 이 수치는 10월 2일 발표됐다.";
  const SUMMARY = "물가는 3.2% 둔화됐고 10월 2일 발표됐다.";

  /**
   * 🔴 **A check is anchored to the article it was run against, and that is not obvious enough to leave
   * unsaid.** Two places compute one: the server, when the summary is made, and the screen, every time the
   * boxes change. Cowork's screen deliberately draws only the second (Round 944 §3), on what turned out to be
   * a mistaken premise — "same function, same inputs, same answer". It is the right decision for a different
   * reason, and these pairs are that reason, moved next to the function it is a property of.
   *
   * At the moment a summary arrives the two agree, so nothing here contradicts the screen's behaviour today.
   * What these pin is that they **stop** agreeing the instant the article changes — because then they are
   * answers to two different questions, and only one of them is about what a person is looking at.
   */
  it("is true of the article it was given, so shortening the article can uncover a claim", () => {
    const asSent = checkNewsSummary(SUMMARY, ARTICLE);
    expect(asSent.missing).toHaveLength(0);

    const shortened = checkNewsSummary(SUMMARY, "통계청은 3.2%라고 밝혔다.");
    expect(shortened.missing.map((claim) => claim.text)).toEqual(["10월 2일"]);
  });

  /** 🔴 The worst shape of it: correcting a typo in the article turns a checked figure into an invented one. */
  it("turns a figure invented once the article stops saying it", () => {
    const corrected = checkNewsSummary(SUMMARY, "통계청은 3.5%라고 밝혔다. 이 수치는 10월 2일 발표됐다.");
    expect(corrected.missing.map((claim) => claim.text)).toEqual(["3.2%"]);
  });

  /** And adding to the article only ever widens what can be found — the safe direction, and still a change. */
  it("can only gain ground when the article grows", () => {
    const fuller = checkNewsSummary(SUMMARY, `${ARTICLE} 장관은 7.8%도 언급했다.`);
    expect(fuller.missing).toHaveLength(0);
  });

  /**
   * 🟠 The one difference between the two callers that is **not** a divergence: the server checks the summary
   * as the provider wrote it, the screen checks it trimmed. Measured over the shapes where ends could matter —
   * a trailing newline, leading spaces, tabs on both sides, an invented figure, a date last, a quote last —
   * and it changes nothing, which is why the two agree at arrival.
   */
  it("does not care about whitespace at the ends of a summary", () => {
    const body = `${ARTICLE} 장관은 "재정 건전성은 지킨다"고 말했다.`;
    for (const raw of [
      "물가는 3.2% 둔화됐다.\n",
      "   물가는 3.2% 둔화됐다.",
      "\t\n 물가는 3.2% 둔화됐다. \n\t",
      "물가는 7.8% 올랐다.\n",
      "발표는 10월 2일이다.\n",
      '장관은 "재정 건전성은 지킨다"\n',
    ]) {
      expect(checkNewsSummary(raw, body), raw).toEqual(checkNewsSummary(raw.trim(), body));
    }
  });
});
