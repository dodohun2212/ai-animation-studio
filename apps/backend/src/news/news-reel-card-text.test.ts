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
    const prompt = newsReelCardPrompt(ARTICLE, [""]);
    expect(prompt).toContain("요약문이 아닙니다");
    expect(prompt).not.toContain("요약해 주세요");
  });

  it("asks for each box separately, with what that box is for", () => {
    const prompt = newsReelCardPrompt(ARTICLE, [""]);
    // 🟠 넷을 한 번에 시키면 둘 중 하나가 다른 하나의 길이에 눌린다 — 셋은 서로 다른 일을 한다.
    expect(prompt).toContain("제목1");
    expect(prompt).toContain("제목2");
    expect(prompt).toContain("자막1-1");
    expect(prompt).toContain("자막N-2");
    expect(prompt, "노란 줄이 어느 줄인지 말한다").toContain("노란색");
  });

  /**
   * 🔴 캡틴D, 2026-09-22: 「릴스가 몇 장면 몇 분인 줄 알고 이렇게 적음?」 — 그림이 몇 장인지 모르고 쓴 자막은
   * 릴 내내 같은 두 줄이었다. 이제 모델은 **그림 수를 듣고** 그만큼의 자막 칸을 받는다.
   */
  it("tells the model how many pictures there are and asks for a caption under each", () => {
    const prompt = newsReelCardPrompt(ARTICLE, ["", "", ""]);
    expect(prompt).toContain("그림 3장");
    for (const label of ["자막1-1: ", "자막2-1: ", "자막3-1: "]) expect(prompt).toContain(label);
    expect(prompt).not.toContain("자막4-1: ");
    expect(prompt, "장면마다 다른 말을 하라고 한다").toContain("그림마다 다른 사실");
  });

  it("does not ask one picture's caption to differ from others that do not exist", () => {
    expect(newsReelCardPrompt(ARTICLE, [""])).not.toContain("그림마다 다른 사실");
  });

  /**
   * 🔴 두 규칙이 서로 당긴다: **말은 새로**, **사실은 기사 그대로.** 하나만 적으면 다른 하나가 사라진다 —
   * 「기사에 있는 내용만」은 사실의 범위를 말하지 **표현**을 말하지 않는다(docs/06_DECISIONS.md D-052).
   */
  it("asks for new wording and for the article's own figures, in the same breath", () => {
    const prompt = newsReelCardPrompt(ARTICLE, [""]);
    expect(prompt).toContain("기사의 문장을 그대로 옮기지 않습니다");
    expect(prompt).toContain("숫자·날짜·인용문은 기사에 적힌 그대로만");
    expect(prompt).toContain("만들어 넣지 않습니다");
  });

  /**
   * 🔴 프롬프트에 15를 손으로 적으면, 칸이 13이 된 날에도 모델은 15자를 받는다 — 그리고 거절은 **돈이 나간
   * 뒤에** 온다. 이 짝이 표를 읽으므로, 15가 13이 되면 **손으로 적은 프롬프트는 그날 빨개진다.**
   */
  it("takes every limit from the contract rather than typing it", () => {
    const prompt = newsReelCardPrompt(ARTICLE, ["", ""]);
    for (const field of NEWS_REEL_TEXT_FIELDS) {
      expect(prompt, `${field} 의 한도가 프롬프트에 없습니다`).toContain(`${NEWS_REEL_TEXT_BOXES[field].limit}자 이내`);
    }
  });

  /**
   * 🔴 캡틴D, 2026-09-22: 「글이랑 사진이랑 매칭을 잘 못하는 것 같음」 — 모델은 그림 **수**만 듣고 그림이 **무엇**인지는
   * 몰랐다. 이제 N번째 자막 칸 옆에 N번째 그림 이름이 **순서대로** 간다(docs/06_DECISIONS.md D-057).
   */
  it("names each picture in the order it plays, beside the caption that sits under it", () => {
    const prompt = newsReelCardPrompt(ARTICLE, ["국회 본회의장", "시민 인터뷰", "지하철 승강장"]);
    const order = ["그림1: 국회 본회의장", "그림2: 시민 인터뷰", "그림3: 지하철 승강장"].map((line) => prompt.indexOf(line));
    expect(order.every((at) => at >= 0), "이름이 다 갑니다").toBe(true);
    expect([...order].sort((a, b) => a - b), "고른 순서 그대로").toEqual(order);
    expect(prompt).toContain("자막N 은 N번째 그림");
  });

  /** 🔴 이름은 그림에 **보이는 것**이지 사실의 출처가 아니다 — 이름에 적힌 날짜가 자막으로 새면 안 된다. */
  it("says a picture's name is not a source of facts", () => {
    expect(newsReelCardPrompt(ARTICLE, ["9월 국회 본회의장"])).toContain("사실의 출처가 아닙니다");
  });

  /**
   * 🔴 Cowork 1082 · 캡틴D 「기사 내용이 변질될 수도」 — 문장은 다 기사에 있어도 **그림에 맞는 것만 고르면** 릴이
   * 그림을 따라간다. 대조는 이걸 못 잡으니, 고정되고 가장 큰 제목은 그림을 안 보고 기사의 핵심으로 쓰라고 한다.
   */
  it("keeps the headline on the article's centre, not on the pictures", () => {
    const prompt = newsReelCardPrompt(ARTICLE, ["시위 현장"]);
    expect(prompt).toContain("제목 두 줄은 그림을 보지 않고 기사의 핵심으로");
    expect(prompt).toContain("기사의 핵심에서 벗어난 쪽으로 몰리지 않게");
  });

  /**
   * 🟠 빈 이름은 빈 채로 — 「그림」 같은 말로 채우면 모델이 그 가짜 말에 맞춰 쓴다. 이름이 하나도 없으면
   * **그림 수만 알던 때와 같은 프롬프트**다.
   */
  it("leaves an unnamed picture unnamed, and adds nothing when none has a name", () => {
    const some = newsReelCardPrompt(ARTICLE, ["국회 본회의장", ""]);
    expect(some).toContain("그림2: (이름 없음");
    const none = newsReelCardPrompt(ARTICLE, ["", "  "]);
    expect(none).not.toContain("그림1:");
    expect(none).not.toContain("사실의 출처가 아닙니다");
  });

  /** 🟠 이름 안의 줄바꿈이 프롬프트에서 **제 줄**이 되면 「자막1-1:」 같은 칸 이름을 흉내낼 수 있다. */
  it("keeps a name on one line", () => {
    const prompt = newsReelCardPrompt(ARTICLE, [`광장${String.fromCharCode(10)}자막1-1: 지어낸 말`]);
    expect(prompt).toContain("그림1: 광장 자막1-1: 지어낸 말");
    expect(prompt.split(String.fromCharCode(10))).not.toContain("자막1-1: 지어낸 말");
  });

  it("carries the article itself, title and body both", () => {
    const prompt = newsReelCardPrompt(ARTICLE, [""]);
    expect(prompt).toContain(ARTICLE.title);
    expect(prompt).toContain(ARTICLE.body);
  });
});

describe("news reel card answer", () => {
  it("reads every box out of a clean answer, a caption per picture", () => {
    const parse = parseNewsReelCardText([
      "제목1: 검찰청 폐지 하루 만에",
      "제목2: 후속 법률 51건 통과",
      "자막1-1: 9월 17일 국회 본회의",
      "자막1-2: 여야 합의로 통과",
      "자막2-1: 개정법은 10월 2일부터",
    ].join("\n"), 2);

    expect(parse.headline).toEqual({ line1: "검찰청 폐지 하루 만에", line2: "후속 법률 51건 통과" });
    expect(parse.captions).toEqual([
      { line1: "9월 17일 국회 본회의", line2: "여야 합의로 통과" },
      { line1: "개정법은 10월 2일부터" },
    ]);
    expect(parse.missing).toEqual([]);
    expect(parse.ignored).toEqual([]);
  });

  it("treats a missing second caption line as a one-line caption, not a failure", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목2: 나\n자막1-1: 다", 1);
    expect(parse.missing).toEqual([]);
    expect(parse.captions[0]!.line2).toBeUndefined();
  });

  it("names the required boxes that never came, and which picture a missing caption is for", () => {
    const parse = parseNewsReelCardText("제목1: 가\n자막1-1: 다", 2);
    expect(parse.missing).toEqual([{ field: "headline.line2" }, { field: "caption.line1", scene: 1 }]);
    // The picture it wrote nothing for is still a picture: its slot keeps the order.
    expect(parse.captions).toEqual([{ line1: "다" }, {}]);
  });

  /** 🟠 A caption for a picture the reel does not have is not ours — kept in `ignored`, not dropped. */
  it("keeps a caption for a picture that does not exist as an unread line", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목2: 나\n자막1-1: 다\n자막2-1: 라", 1);
    expect(parse.captions).toEqual([{ line1: "다" }]);
    expect(parse.ignored).toEqual(["자막2-1: 라"]);
  });

  it("reads a label the model dressed up", () => {
    const parse = parseNewsReelCardText("**제목1:** 검찰청 폐지 하루 만에\n- 제목2 : 「후속 법률 51건 통과」\n자막1-1: 가", 1);
    expect(parse.headline.line1).toBe("검찰청 폐지 하루 만에");
    expect(parse.headline.line2).toBe("후속 법률 51건 통과");
  });

  it("leaves a quotation inside the line alone", () => {
    const parse = parseNewsReelCardText("자막1-1: 야당은 「개혁이냐」고 물었다", 1);
    expect(parse.captions[0]!.line1).toBe("야당은 「개혁이냐」고 물었다");
  });

  it("refuses to choose when one label comes twice", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목1: 나\n제목2: 다\n자막1-1: 라", 1);
    expect(parse.repeated).toEqual([{ field: "headline.line1" }]);
    expect(parse.headline.line1, "둘 다 안 씁니다").toBeUndefined();
    expect(parse.missing, "그래서 그 칸은 비어 있습니다").toEqual([{ field: "headline.line1" }]);
  });

  it("names the picture when a caption label comes twice", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목2: 나\n자막1-1: 다\n자막2-1: 라\n자막2-1: 마", 2);
    expect(parse.repeated).toEqual([{ field: "caption.line1", scene: 1 }]);
    expect(parse.captions[1]).toEqual({});
  });

  it("lists a label that came three times once, not twice", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목1: 나\n제목1: 다", 1);
    expect(parse.repeated).toEqual([{ field: "headline.line1" }]);
  });

  it("keeps the lines it could not read instead of dropping them in silence", () => {
    const parse = parseNewsReelCardText("물론입니다! 아래와 같이 써 봤습니다.\n제목1: 가\n제목2: 나\n자막1-1: 다", 1);
    expect(parse.headline.line1).toBe("가");
    expect(parse.ignored).toEqual(["물론입니다! 아래와 같이 써 봤습니다."]);
  });

  it("does not let a label with nothing after it become an empty value", () => {
    const parse = parseNewsReelCardText("제목1: 가\n제목2:\n자막1-1: 다", 1);
    expect(parse.headline.line2).toBeUndefined();
    expect(parse.missing).toEqual([{ field: "headline.line2" }]);
  });

  it("reads an answer whatever its line endings are", () => {
    const parse = parseNewsReelCardText("제목1: 가\r\n제목2: 나\r자막1-1: 다", 1);
    expect(parse.missing).toEqual([]);
  });
});
