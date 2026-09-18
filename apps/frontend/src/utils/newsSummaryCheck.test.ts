import { describe, expect, it } from "vitest";

import { checkNewsSummary } from "./newsSummaryCheck.js";

/** 오늘자 기사 하나를 줄여 쓴 것 — 숫자·날짜·인용문이 다 들어 있는 모양이라 그대로 씁니다. */
const ARTICLE = [
  "국회는 2026년 9월 17일 검찰청 폐지에 따른 후속 법률 51건을 통과시켰다.",
  "개정법은 10월 2일부터 시행된다. 검사의 직접 수사권은 사법경찰로 넘어가고, 검찰청은 공소청으로 이름이 바뀐다.",
  "중대범죄수사청은 아동학대, 가정폭력, 성범죄 등 7개 분야에서 보완수사를 할 수 있다.",
  "납품대금 지급 기한은 직접 구매의 경우 60일에서 35일로, 위탁 구매는 40일에서 20일로 줄었다.",
  "야당은 \"시행 2주를 앞두고 후속 작업을 한꺼번에 밀어붙이는 것을 제대로 된 개혁이라 할 수 있느냐\"고 비판했다.",
  "여당은 관련 상임위원회에서 소위원회를 거쳐 충분히 논의했다는 입장이다.",
].join("\n");

describe("checkNewsSummary", () => {
  /**
   * 🔴 이 검사가 없으면 이 기능은 **틀린 사실을 예쁘게 만들어 퍼뜨리는 기계**가 됩니다. 요약 AI 는 원문에
   * 없는 숫자와 날짜를 그럴듯하게 지어내고, 그건 꽃말 릴에서는 시시하지만 뉴스에서는 사람이 잘못된 걸
   * 믿고 옮깁니다. 그래서 짝의 첫 줄은 「통과한다」가 아니라 **「지어낸 것을 잡는다」**입니다.
   */
  it("catches a number the article never states", () => {
    const { unverified } = checkNewsSummary("국회가 후속 법안 53건을 통과시켰다.", ARTICLE);
    expect(unverified).toEqual([{ kind: "number", text: "53건" }]);
  });

  it("catches a date the article never states", () => {
    const { unverified } = checkNewsSummary("개정법은 10월 12일부터 시행된다.", ARTICLE);
    expect(unverified).toEqual([{ kind: "date", text: "10월 12일" }]);
  });

  /** 아무도 하지 않은 말이 인용부호 안에 들어가는 것 — 뉴스에서 제일 비싼 종류의 지어냄입니다. */
  it("catches a quote nobody in the article said", () => {
    const { unverified } = checkNewsSummary('여당은 "완벽한 개혁이다"라고 말했다.', ARTICLE);
    expect(unverified).toEqual([{ kind: "quote", text: "완벽한 개혁이다" }]);
  });

  it("passes a summary that only says what the article says", () => {
    const summary = "국회가 2026년 9월 17일 후속 법안 51건을 통과시켰다. 10월 2일부터 시행되고, 검찰청은 공소청으로 바뀐다.";
    const { unverified, checked } = checkNewsSummary(summary, ARTICLE);
    expect(unverified).toEqual([]);
    // 🔴 「막지 않았다」와 「검사할 게 있었다」는 다른 사실입니다 — 0 이면 통과가 아니라 빈 검사입니다.
    expect(checked).toBeGreaterThan(0);
  });

  /**
   * 🔴 날짜를 숫자 여럿으로 쪼개 보면 **지어낸 날짜가 통과합니다.** 「10월 12일」의 10 과 12 는 이 기사
   * 어딘가에 다 있습니다(10월 2일 · 51건… 실은 12 도 흔합니다). 붙은 덩어리째 찾아야 잡힙니다.
   */
  it("does not let a fabricated date slip through because its digits appear elsewhere", () => {
    const { unverified } = checkNewsSummary("시행일은 9월 20일이다.", ARTICLE);
    expect(unverified.some((u) => u.kind === "date" && u.text === "9월 20일")).toBe(true);
    // 그 날짜가 숫자 두 개로도 다시 잡히면 안 됩니다 — 한 사실은 한 번만 보고합니다.
    expect(unverified.filter((u) => u.text.includes("20")).length).toBe(1);
  });

  /**
   * 🔴 이 짝은 제가 실제로 낸 버그를 붙듭니다 (Cowork Round 908).
   *
   * 날짜를 원문에서 찾을 때 정규식을 쓰면서 **공백을 `\s*` 로 바꾼 뒤에** 특수문자를 escape 했더니, 방금
   * 넣은 `*` 까지 escape 되어 「s 라는 글자 뒤에 별표」를 찾게 됐습니다. 결과는 **멀쩡한 요약의 날짜가
   * 전부 빨강** — 검사가 아무것도 통과시키지 않는 상태였고, 그러면 사람은 검사를 꺼 버립니다.
   * 짝을 돌리기 전에 손으로 한 번 돌려 봐서 잡았습니다.
   *
   * 고친 뒤 두 번째 판도 틀렸습니다: 요약 쪽 공백만 느슨하게 해서, **요약에만 공백이 없는 경우**를 못
   * 찾았습니다. 양쪽에서 공백을 빼고 비교하는 지금 판이 두 방향을 한 번에 풉니다. 그래서 이 짝도 두 방향입니다.
   */
  it("finds a date whichever side wrote the spaces", () => {
    // 원문에 공백이 있고 요약에는 없는 경우
    expect(checkNewsSummary("2026년9월17일에 통과됐다.", ARTICLE).unverified).toEqual([]);
    // 그 반대
    expect(checkNewsSummary("2026년 9월 17일에 통과됐다.", "국회는 2026년9월17일 통과시켰다.").unverified).toEqual([]);
  });

  /**
   * 🔴 **거짓 통과** — 이 검사가 절대 틀리면 안 되는 방향입니다. CLI Round 910 이 자기 대조기에서 먼저
   * 잡았고, 제 것도 같은 모양이었습니다: 부분 문자열로 찾으면 원문의 「4,000」 안에 요약의 「40」이 들어
   * 있어서 통과합니다. **없는 숫자가, 진짜 큰 숫자와 앞자리가 같다는 이유로 승인되는 것**입니다.
   * 지어낸 값을 막자고 만든 검사가 지어낸 값을 통과시키면, 있으나 마나가 아니라 있는 게 더 나쁩니다.
   */
  it("does not let a fabricated number pass because a bigger number starts with it", () => {
    const article = "예산은 4,000억 원으로 정해졌다. 기한은 3.5일 줄었다.";
    expect(checkNewsSummary("예산은 40억 원이다.", article).unverified)
      .toEqual([{ kind: "number", text: "40억" }]);
    // 소수점도 경계입니다 — 「3.5」를 「3」이 통과시키면 안 됩니다.
    expect(checkNewsSummary("기한은 3일 줄었다.", article).unverified)
      .toEqual([{ kind: "number", text: "3일" }]);
    // 진짜로 그 숫자면 통과해야 합니다 — 경계를 넣다가 멀쩡한 것까지 막으면 사람이 검사를 꺼 버립니다.
    expect(checkNewsSummary("예산은 4000억 원이다.", article).unverified).toEqual([]);
  });

  /** 자릿점은 뜻이 아닙니다 — 원문 「1,000」과 요약 「1000」은 같은 사실입니다. */
  it("treats a thousands separator as the same number", () => {
    const article = "예산은 1,000억 원으로 정해졌다.";
    expect(checkNewsSummary("예산은 1000억 원이다.", article).unverified).toEqual([]);
  });

  /** 따옴표 모양도 뜻이 아닙니다 — 낫표로 옮겨 적어도 같은 말입니다. */
  it("treats curly quotes and corner brackets as the same quote", () => {
    const summary = "야당은 「시행 2주를 앞두고 후속 작업을 한꺼번에 밀어붙이는 것을 제대로 된 개혁이라 할 수 있느냐」고 비판했다.";
    expect(checkNewsSummary(summary, ARTICLE).unverified).toEqual([]);
  });

  /**
   * 단위가 바뀐 것은 지어낸 것이 아닙니다 — 원문 「51건」을 요약이 「51개」라고 적어도 숫자는 같습니다.
   * 이걸 막으면 멀쩡한 요약이 빨개지고, 그러면 사람이 검사를 믿지 않게 됩니다.
   */
  it("does not flag a number whose unit was reworded", () => {
    expect(checkNewsSummary("법안 51개가 통과됐다.", ARTICLE).unverified).toEqual([]);
  });

  it("reports each fabricated item once, even when the summary repeats it", () => {
    const { unverified } = checkNewsSummary("53건이 통과됐다. 그 53건은 곧 시행된다.", ARTICLE);
    expect(unverified).toHaveLength(1);
  });

  /**
   * 🟠 이 검사가 **못 잡는 것**도 짝으로 적어 둡니다. 숫자도 단어도 원문에 있는데 붙여 쓴 적이 없는 경우는
   * 통과합니다. 화면이 「확인됐습니다」라고 말하면 안 되는 이유가 이것이고, 이 짝이 그 한계를 문서가 아니라
   * **코드로** 붙들어 둡니다 — 나중에 누가 「이 검사가 사실을 보장한다」고 읽지 않도록.
   */
  it("is a floor, not a guarantee: a number attached to the wrong thing still passes", () => {
    const { unverified } = checkNewsSummary("납품대금 지급 기한이 51일로 줄었다.", ARTICLE);
    expect(unverified).toEqual([]);
  });

  it("says nothing was checked when the summary states no hard facts", () => {
    const { unverified, checked } = checkNewsSummary("국회가 검찰 제도를 크게 바꾸기로 했다.", ARTICLE);
    expect(unverified).toEqual([]);
    expect(checked).toBe(0);
  });
});
