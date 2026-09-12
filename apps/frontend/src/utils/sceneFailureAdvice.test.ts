import { describe, expect, it } from "vitest";

import { imageFailureMessage, mergeClipsInvalidMessage, mergeFailureMessage, narrationFailureMessage, sceneRemedyAdvice } from "./sceneFailureAdvice.js";

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

/**
 * 🔴 같은 조건, 다른 명사. `imageFailureMessage` 와 한 몸통을 쓰는지를 보는 짝입니다 — 두 벌로 갈라지면
 * 762·763·766 에서 한 번씩 틀렸던 조건들을 **두 번씩** 맞춰야 합니다.
 */
describe("narrationFailureMessage", () => {
  it("says it in the narration's own words, with the same conditions", () => {
    const message = narrationFailureMessage("OpenAI 서버 오류입니다.", {
      category: "server", sceneNumber: 4, scope: "run", billedOnFailure: true,
    });

    expect(message).toContain("4번 장면에서 멈췄습니다");
    // 「그림」이 아니라 「음성」 — 명사만 다릅니다.
    expect(message).toContain("음성은 저장돼 있어");
    expect(message).not.toContain("그림");
    expect(message).toContain("OpenAI 서버 오류입니다.");
    expect(message).toContain("예산에는 쓴 것으로");
  });

  it("drops the scene sentence for a scope it does not recognise, exactly as the image side does", () => {
    const message = narrationFailureMessage("분류 문장.", { sceneNumber: 4, scope: "somewhere_new", billedOnFailure: false });

    expect(message).toBe("분류 문장.");
  });

  it("never promises a resume for one scene's redo", () => {
    const message = narrationFailureMessage("분류 문장.", { sceneNumber: 5, scope: "scene" });

    expect(message).toContain("5번 장면 음성을 다시 만들지 못했습니다");
    expect(message).not.toContain("이어서");
  });
});

/**
 * 🔴 합치기는 ②-3 에서 마지막까지 「실패했습니다」 한 줄이던 곳입니다. 세 단계는 할 일이 서로 다릅니다 —
 * 장면 단계면 그 클립 하나, 배경음 단계면 영상이 아니라 고른 음악. 단계를 **틀리게** 말하면 멀쩡한 클립을
 * 다시 만들러 보내고, 유료 모델에서 그건 돈입니다.
 */
describe("mergeFailureMessage", () => {
  const BASE = "최종 영상 만들기를 끝내지 못했습니다. 승인된 장면들은 그대로 남아 있습니다.";

  it("names the scene whose clip stopped the render, and keeps what survived", () => {
    const message = mergeFailureMessage(BASE, { stage: "scene", sceneNumber: 4 });

    expect(message).toContain("4번 장면 클립");
    expect(message).toContain("그 장면 영상을 확인해 주세요");
    // 보존 문장은 절대 밀려나지 않습니다 — 그게 전부 다시 만들기를 막는 절반입니다.
    expect(message).toContain(BASE);
  });

  it("points at the music for a music-stage failure, not at the clips", () => {
    const message = mergeFailureMessage(BASE, { stage: "music" });

    expect(message).toContain("배경음");
    expect(message).toContain("음악 파일이나 시작 지점");
    expect(message).not.toContain("장면 클립");
  });

  it("says only the step it can name for a join failure", () => {
    expect(mergeFailureMessage(BASE, { stage: "join" })).toContain("이어 붙이는 단계");
    expect(mergeFailureMessage(BASE, { stage: "join" })).not.toContain("번 장면");
  });

  /** 766 규칙 — 모르는 값이면 단계 문장을 통째로 뺍니다. 틀린 단계는 없는 단계보다 나쁩니다. */
  it("reads exactly as before for an unknown stage, an absent stage, or no details at all", () => {
    expect(mergeFailureMessage(BASE, { stage: "colour_grade" })).toBe(BASE);
    expect(mergeFailureMessage(BASE, { sceneNumber: 4 })).toBe(BASE);
    expect(mergeFailureMessage(BASE, undefined)).toBe(BASE);
  });

  /** stage 는 맞는데 장면 번호가 못 쓸 값이면, 단계만 말하고 번호는 지어내지 않습니다. */
  it("does not invent a scene number from a value that is not one", () => {
    const message = mergeFailureMessage(BASE, { stage: "scene", sceneNumber: 0 });

    expect(message).toContain("한 장면 클립");
    expect(message).not.toContain("0번");
  });
});

describe("mergeClipsInvalidMessage", () => {
  const BASE = "승인된 장면 영상 파일을 확인할 수 없습니다. 영상 검토 화면에서 장면을 다시 확인해 주세요.";
  const TAIL = "영상 검토 화면에서 그 장면을 다시 확인해 주세요.";

  it("names the scenes instead of sending someone through all of them", () => {
    const message = mergeClipsInvalidMessage(BASE, { sceneNumbers: [7, 4, 4] }, TAIL);

    // 정렬되고 중복이 없습니다 — 서버가 준 순서가 사람이 읽을 순서일 이유는 없습니다.
    expect(message).toContain("4·7번 장면 영상을 확인할 수 없습니다");
    expect(message).toContain(TAIL);
  });

  /** 빈 배열은 「못 고르겠다」는 서버의 답입니다. 「번 장면」 앞에 아무것도 없는 문장보다 원래 문장이 낫습니다. */
  it("falls back to the general sentence when the server could not tell which", () => {
    expect(mergeClipsInvalidMessage(BASE, { sceneNumbers: [] }, TAIL)).toBe(BASE);
    expect(mergeClipsInvalidMessage(BASE, undefined, TAIL)).toBe(BASE);
    expect(mergeClipsInvalidMessage(BASE, { sceneNumbers: [1, 0] }, TAIL)).toBe(BASE);
    expect(mergeClipsInvalidMessage(BASE, { sceneNumbers: ["1"] }, TAIL)).toBe(BASE);
  });
});
