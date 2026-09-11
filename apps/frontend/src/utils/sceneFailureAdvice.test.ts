import { describe, expect, it } from "vitest";

import { imageFailureMessage, sceneRemedyAdvice } from "./sceneFailureAdvice.js";

const CATEGORY = "OpenAI API 키 인증에 실패했습니다. API 설정 화면에서 키가 올바른지 확인해 주세요.";

describe("imageFailureMessage", () => {
  it("answers item 2's three questions from one error: where it stopped, what survived, what the budget did", () => {
    const message = imageFailureMessage(CATEGORY, { category: "safety_policy", sceneNumber: 3, scope: "run", billedOnFailure: true, remedy: "not_retryable" });

    expect(message).toContain("3번 장면에서 멈췄습니다");
    expect(message).toContain("3번부터 이어서");
    expect(message).toContain(CATEGORY);
    expect(message).toContain(sceneRemedyAdvice("not_retryable"));
    expect(message).toContain("예산에는 쓴 것으로 계상");
  });

  /*
   * 🔴 The contract omits `remedy` for authentication and quota deliberately: all three of its sentences are
   * about the scene's input, and none is true of a bad key. Defaulting through `sceneRemedyAdvice(undefined)`
   * would print 「아래에 무엇을 바꿀지 적어 주세요」 over a key problem — a confident wrong answer, which is worse
   * than the hedge it replaced.
   */
  it("gives no input advice when the contract withheld it", () => {
    const message = imageFailureMessage(CATEGORY, { category: "authentication", sceneNumber: 1, scope: "run", billedOnFailure: true });

    expect(message).toContain(CATEGORY);
    expect(message).not.toContain("무엇을 바꿀지");
    expect(message).not.toContain("입력 자체가 원인");
  });

  /*
   * 🔴 A response from a build that predates these fields must not become a claim. Every added part is
   * conditional, and with nothing to add the sentence is exactly what this screen said before.
   */
  it("says only the category when the error carries no details", () => {
    expect(imageFailureMessage(CATEGORY, undefined)).toBe(CATEGORY);
    expect(imageFailureMessage(CATEGORY, {})).toBe(CATEGORY);
  });

  /*
   * 🔴 The one door left open by a cast. `remedy` used to be taken from any string, so a typo or a newer server
   * would reach `sceneRemedyAdvice`'s `default` — the hedged 「무엇을 바꿀지 적어 주세요」 that this function
   * withholds on purpose when the contract omits the field. Withholding it for `undefined` and then printing it
   * for `"foo"` is the same wrong answer through a different hole.
   */
  it("treats a remedy it does not recognise as no remedy at all", () => {
    for (const remedy of ["foo", "", "RETRY", 3, null]) {
      const message = imageFailureMessage(CATEGORY, { category: "authentication", sceneNumber: 1, scope: "run", billedOnFailure: true, remedy });
      expect(message, String(remedy)).not.toContain("무엇을 바꿀지");
      expect(message, String(remedy)).not.toContain("입력 자체가 원인");
      expect(message, String(remedy)).not.toContain("같은 요청으로는 통과하지 않습니다");
    }
  });

  /*
   * 🔴 The sentence that was false for half the cases it was shown in.
   *
   * A Long Episode sends a whole run and a single scene's redraw under ONE error code, so the code cannot say
   * which happened — and 「N번부터 이어서 만듭니다」 is wrong for a redraw: nothing resumes, the other scenes
   * were never touched, and the button in front of the person says 「N번 다시 만들기」. CLI caught this on the
   * screen before it shipped.
   */
  it("promises a resume only for a run, never for one scene's redraw", () => {
    const run = imageFailureMessage(CATEGORY, { category: "safety_policy", sceneNumber: 5, scope: "run", billedOnFailure: true });
    expect(run).toContain("5번부터 이어서");

    const scene = imageFailureMessage(CATEGORY, { category: "safety_policy", sceneNumber: 5, scope: "scene", billedOnFailure: true });
    expect(scene).toContain("5번 장면을 다시 그리지 못했습니다");
    expect(scene).toContain("다른 장면은 그대로");
    expect(scene).not.toContain("이어서");
    expect(scene).not.toContain("저장돼 있어");
  });

  /*
   * 🔴 Without a scope the two sentences are a coin flip, so neither is said. Same rule as `remedy`: a value we
   * do not recognise is not a value, and a confident wrong sentence is worse than a quiet one.
   */
  it("claims nothing about the scene when the scope is missing or unknown", () => {
    for (const scope of [undefined, "", "RUN", "batch", 1, null]) {
      const message = imageFailureMessage(CATEGORY, { category: "safety_policy", sceneNumber: 5, scope, billedOnFailure: true });
      expect(message, String(scope)).not.toContain("5번");
      expect(message, String(scope)).not.toContain("이어서");
      // The rest still stands — an unreadable scope is not a reason to drop what we do know.
      expect(message, String(scope)).toContain(CATEGORY);
      expect(message, String(scope)).toContain("예산에는 쓴 것으로 계상");
    }
  });

  it("does not invent a scene number from a value that is not one", () => {
    for (const sceneNumber of [0, -1, 1.5, "3", null]) {
      expect(imageFailureMessage(CATEGORY, { sceneNumber, scope: "run", billedOnFailure: false })).toBe(CATEGORY);
    }
  });

  // 「계상되지 않았다」 is not the same as saying nothing, and only the true half may be stated.
  it("says nothing about the budget when the failure was not counted", () => {
    expect(imageFailureMessage(CATEGORY, { sceneNumber: 2, scope: "run", billedOnFailure: false })).not.toContain("예산");
  });
});
