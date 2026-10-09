import { describe, expect, it } from "vitest";

import { fieldsContaining, removeQuoteMarks } from "./newsClaimFix.js";

describe("removeQuoteMarks", () => {
  it("takes the marks off a quoted span, whatever kind of marks, and keeps the words", () => {
    expect(removeQuoteMarks("해경은 「허가 없는 배 엄벌」 방침을 밝혔다", "허가 없는 배 엄벌")).toBe("해경은 허가 없는 배 엄벌 방침을 밝혔다");
    expect(removeQuoteMarks("“허가 없는 배 엄벌”", "허가 없는 배 엄벌")).toBe("허가 없는 배 엄벌");
    expect(removeQuoteMarks("'허가 없는 배 엄벌' 그리고 \"허가 없는 배 엄벌\"", "허가 없는 배 엄벌")).toBe("허가 없는 배 엄벌 그리고 허가 없는 배 엄벌");
  });

  it("matches across odd spacing and leaves other quotes alone", () => {
    expect(removeQuoteMarks("「허가  없는 배 엄벌」", "허가 없는 배 엄벌")).toBe("허가  없는 배 엄벌");
    expect(removeQuoteMarks("「다른 말」과 「허가 없는 배 엄벌」", "허가 없는 배 엄벌")).toBe("「다른 말」과 허가 없는 배 엄벌");
  });

  it("returns the text unchanged when there is nothing to take off", () => {
    expect(removeQuoteMarks("허가 없는 배 엄벌", "허가 없는 배 엄벌")).toBe("허가 없는 배 엄벌");
    expect(removeQuoteMarks("아무 말", "")).toBe("아무 말");
    expect(removeQuoteMarks("a.b 「a.b」", "a.b")).toBe("a.b a.b");
  });
});

describe("fieldsContaining", () => {
  it("names the fields a span is in", () => {
    const fields = [
      { label: "제목 첫 줄", value: "단속 강화" },
      { label: "1번 장면 자막", value: "「허가 없는 배 엄벌」" },
      { label: "게시 본문 요약", value: "해경은 허가 없는  배 엄벌 방침" },
    ];
    expect(fieldsContaining("허가 없는 배 엄벌", fields).map((field) => field.label)).toEqual(["1번 장면 자막", "게시 본문 요약"]);
    expect(fieldsContaining("", fields)).toEqual([]);
  });
});
