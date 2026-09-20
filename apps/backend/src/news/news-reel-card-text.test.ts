import { NEWS_REEL_TEXT_BOXES, NEWS_REEL_TEXT_FIELDS } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

import { newsReelCardPrompt, parseNewsReelCardText } from "./news-reel-card-text.js";

const ARTICLE = {
  title: "국회, 검찰청 폐지 후속 법률 51건 통과",
  body: "국회는 2026년 9월 17일 검찰청 폐지에 따른 후속 법률 51건을 통과시켰다. 개정법은 10월 2일부터 시행된다.",
  publisher: "연합뉴스",
  publishedAt: "2026-09-17T09:12:00.000Z",
  sourceUrl: "https://www.yna.co.kr/view/AKR1",
};

describe("news reel card prompt", () => {
  /**
   * 🔴 이 한 줄이 이 프롬프트가 생긴 이유다. 요약을 시키면 **통신사 문단**이 오고, 첫 실물에서는 15자짜리
   * 줄에 **271자**가 왔다(docs/06_DECISIONS.md D-052).
   */
  it("does not ask for a summary", () => {
    const prompt = newsReelCardPrompt(ARTICLE);
    expect(prompt).toContain("요약문이 아닙니다");
    expect(prompt).not.toContain("요약해 주세요");
  });

  it("asks for each box separately, with what that box is for", () => {
    const prompt = newsReelCardPrompt(ARTICLE);
    // 🟠 넷을 한 번에 시키면 둘 중 하나가 다른 하나의 길이에 눌린다 — 셋은 서로 다른 일을 한다.
    expect(prompt).toContain("제목1");
    expect(prompt).toContain("제목2");
    expect(prompt).toContain("자막1");
    expect(prompt).toContain("자막2");
    expect(prompt, "노란 줄이 어느 줄인지 말한다").toContain("노란색");
  });

  /**
   * 🔴 두 규칙이 서로 당긴다: **말은 새로**, **사실은 기사 그대로.** 하나만 적으면 다른 하나가 사라진다 —
   * 「기사에 있는 내용만」은 사실의 범위를 말하지 **표현**을 말하지 않는다(docs/06_DECISIONS.md D-052).
   */
  it("asks for new wording and for the article's own figures, in the same breath", () => {
    const prompt = newsReelCardPrompt(ARTICLE);
    expect(prompt).toContain("기사의 문장을 그대로 옮기지 않습니다");
    expect(prompt).toContain("숫자·날짜·인용문은 기사에 적힌 그대로만");
    expect(prompt).toContain("만들어 넣지 않습니다");
  });

  /**
   * 🔴 프롬프트에 15를 손으로 적으면, 칸이 13이 된 날에도 모델은 15자를 받는다 — 그리고 거절은 **돈이 나간
   * 뒤에** 온다.
   *
   * 🟠 **오늘은 이 짝이 손으로 적은 15와 표에서 온 15를 못 가른다.** 가르는 날은 표가 움직이는 날이다 —
   * 이 짝이 표를 읽으므로, 15가 13이 되면 **손으로 적은 프롬프트는 그날 빨개진다.** 그게 이 짝이 하는 일이다.
   */
  it("takes every limit from the contract rather than typing it", () => {
    const prompt = newsReelCardPrompt(ARTICLE);
    for (const field of NEWS_REEL_TEXT_FIELDS) {
      expect(prompt, `${field} 의 한도가 프롬프트에 없습니다`).toContain(`${NEWS_REEL_TEXT_BOXES[field].limit}자 이내`);
    }
  });

  it("carries the article itself, title and body both", () => {
    const prompt = newsReelCardPrompt(ARTICLE);
    expect(prompt).toContain(ARTICLE.title);
    expect(prompt).toContain(ARTICLE.body);
  });
});

describe("news reel card answer", () => {
  it("reads the four boxes out of a clean answer", () => {
    const parse = parseNewsReelCardText([
      "제목1: 검찰청 폐지 하루 만에",
      "제목2: 후속 법률 51건 통과",
      "자막1: 9월 17일 국회 본회의",
      "자막2: 개정법은 10월 2일부터",
    ].join("\n"));

    expect(parse.values).toEqual({
      "headline.line1": "검찰청 폐지 하루 만에",
      "headline.line2": "후속 법률 51건 통과",
      "caption.line1": "9월 17일 국회 본회의",
      "caption.line2": "개정법은 10월 2일부터",
    });
    expect(parse.missing).toEqual([]);
    expect(parse.ignored).toEqual([]);
  });

  /** 🟠 자막 둘째 줄은 **안 쓰는 것이 정상**이다 — 없다고 모자란 답이 아니다. */
  it("treats a missing second caption line as a one-line caption, not a failure", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목2: 나\n자막1: 다");
    expect(parse.missing).toEqual([]);
    expect(parse.values["caption.line2"]).toBeUndefined();
  });

  it("names the required boxes that never came", () => {
    const parse = parseNewsReelCardText("제목1: 가\n자막1: 다");
    expect(parse.missing).toEqual(["headline.line2"]);
  });

  /** 🟠 모델은 굵은 글씨와 따옴표를 즐겨 붙인다. 라벨을 못 읽어 답을 통째로 버리는 쪽이 더 비싸다. */
  it("reads a label the model dressed up", () => {
    const parse = parseNewsReelCardText("**제목1:** 검찰청 폐지 하루 만에\n- 제목2 : 「후속 법률 51건 통과」\n자막1: 가");
    expect(parse.values["headline.line1"]).toBe("검찰청 폐지 하루 만에");
    expect(parse.values["headline.line2"]).toBe("후속 법률 51건 통과");
  });

  /**
   * 🔴 값 **안쪽**의 인용부호는 기사에서 그대로 가져온 인용문이고, 대조는 그걸 글자 그대로 찾는다. 벗겨
   * 내면 **맞던 인용이 안 맞게** 된다.
   */
  it("leaves a quotation inside the line alone", () => {
    const parse = parseNewsReelCardText("자막1: 야당은 「개혁이냐」고 물었다");
    expect(parse.values["caption.line1"]).toBe("야당은 「개혁이냐」고 물었다");
  });

  /**
   * 🔴 같은 라벨이 두 번 오면 **둘 중 무엇을 뜻했는지 여기서는 알 수 없다.** 첫 줄을 고르는 것은 파일에
   * 구워진 뒤에야 드러나는 조용한 결정이다.
   */
  it("refuses to choose when one label comes twice", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목1: 나\n제목2: 다\n자막1: 라");
    expect(parse.repeated).toEqual(["headline.line1"]);
    expect(parse.values["headline.line1"], "둘 다 안 씁니다").toBeUndefined();
    expect(parse.missing, "그래서 그 칸은 비어 있습니다").toEqual(["headline.line1"]);
  });

  it("lists a label that came three times once, not twice", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목1: 나\n제목1: 다");
    expect(parse.repeated).toEqual(["headline.line1"]);
  });

  /**
   * 🔴 돈이 나간 답이다. 라벨 없는 줄이 있다고 통째로 거절하면 **돈은 나가고 남는 건 없다** — 버리되
   * **버렸다고 말한다**, 그래야 사람이 화면에서 손으로 채울 수 있다.
   */
  it("keeps the lines it could not read instead of dropping them in silence", () => {
    const parse = parseNewsReelCardText("물론입니다! 아래와 같이 써 봤습니다.\n제목1: 가\n제목2: 나\n자막1: 다");
    expect(parse.values["headline.line1"]).toBe("가");
    expect(parse.ignored).toEqual(["물론입니다! 아래와 같이 써 봤습니다."]);
  });

  /** 🟠 라벨만 있고 뒤가 빈 줄은 **모델이 그 칸을 안 쓴 것**이다 — 이 계약에 빈 문자열은 값이 아니다. */
  it("does not let a label with nothing after it become an empty value", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목2:\n자막1: 다");
    expect(parse.values["headline.line2"]).toBeUndefined();
    expect(parse.missing).toEqual(["headline.line2"]);
  });

  it("reads an answer whatever its line endings are", () => {
    const parse = parseNewsReelCardText("제목1: 가\r\n제목2: 나\r자막1: 다");
    expect(parse.missing).toEqual([]);
  });
});
