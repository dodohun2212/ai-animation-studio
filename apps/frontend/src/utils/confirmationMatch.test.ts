import { describe, expect, it } from "vitest";

import { collapseForDisplay, confirmationMatches } from "./confirmationMatch.js";

describe("confirmationMatches", () => {
  it("accepts what the screen showed when the stored value carries a newline the input cannot hold", () => {
    // 꽃말_장미's topic is stored with a line break. The dialog rendered it as one spaced line, so the
    // reader could only ever type the spaced form — and the exact comparison rejected it every time.
    const stored = "빨간 장미\n열렬한 사랑";
    expect(collapseForDisplay(stored)).toBe("빨간 장미 열렬한 사랑");
    expect(confirmationMatches("빨간 장미 열렬한 사랑", stored)).toBe(true);
  });

  it("still refuses a different identifier — only whitespace runs and edges are forgiven", () => {
    expect(confirmationMatches("빨간 장미", "빨간 장미\n열렬한 사랑")).toBe(false);
    expect(confirmationMatches("빨간장미 열렬한 사랑", "빨간 장미\n열렬한 사랑")).toBe(false);
    expect(confirmationMatches("  Exact project topic  ", "Exact project topic")).toBe(true);
    expect(confirmationMatches("Exact  project\ttopic", "Exact project topic")).toBe(true);
  });

  it("can never be satisfied when there is nothing to retype", () => {
    // Otherwise an empty box would confirm an irreversible delete on a project with no topic.
    expect(confirmationMatches("", "")).toBe(false);
    expect(confirmationMatches("", "   ")).toBe(false);
    expect(confirmationMatches("anything", "")).toBe(false);
  });
});
