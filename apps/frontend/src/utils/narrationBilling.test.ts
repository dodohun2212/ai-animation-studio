import { describe, expect, it } from "vitest";

import { narrationScenesToSpeak, narrationScenesWithText, type NarrationBillingItem } from "./narrationBilling.js";

/** 순서대로 1번부터. `audio` 는 기본 "none". */
function scenes(entries: Partial<Omit<NarrationBillingItem, "sceneNumber">>[]): NarrationBillingItem[] {
  return entries.map((entry, index) => ({
    sceneNumber: index + 1,
    narration: entry.narration ?? "문장",
    audio: entry.audio ?? "none",
  }));
}

const numbers = (items: NarrationBillingItem[]) => items.map((item) => item.sceneNumber);

describe("narrationScenesWithText", () => {
  it("drops scenes with no sentence, including whitespace-only ones", () => {
    // 빈 칸은 만들 것도 없고 청구도 없습니다 — 공백만 있는 칸도 같습니다.
    expect(numbers(narrationScenesWithText(scenes([{ narration: "문장" }, { narration: "" }, { narration: "   \n " }])))).toEqual([1]);
  });
});

describe("narrationScenesToSpeak", () => {
  it("skips audio that is already real and still matches its text", () => {
    // 확인 상자가 「이미 음성이 있는 장면은 다시 만들지 않아 비용도 들지 않습니다」라고 말하는 그 장면들입니다.
    const items = scenes([{ audio: "generated" }, { audio: "none" }, { audio: "placeholder" }]);
    expect(numbers(narrationScenesToSpeak(items, [])), "가짜 음성은 진짜 목소리가 아니라 다시 만들어집니다").toEqual([2, 3]);
  });

  it("charges again for audio that has fallen behind its text", () => {
    // 있다고 빼면 적게 부르는 쪽 — 사람이 예산 안이라 믿고 눌렀다가 중간에 막힙니다.
    const items = scenes([{ audio: "generated" }, { audio: "generated" }]);
    expect(numbers(narrationScenesToSpeak(items, [2]))).toEqual([2]);
  });

  it("counts every scene when staleness is unknown", () => {
    // 🔴 모를 때 기우는 방향: 많이 부릅니다.
    const items = scenes([{ audio: "generated" }, { audio: "generated" }]);
    expect(numbers(narrationScenesToSpeak(items, undefined))).toEqual([1, 2]);
    expect(numbers(narrationScenesToSpeak(items, [])), "빈 목록은 「모른다」가 아니라 「뒤처진 게 없다」입니다").toEqual([]);
  });

  it("never counts a scene with no sentence, even when it is listed as stale", () => {
    // 문장이 없으면 백엔드가 건너뜁니다(skippedSceneNumbers) — 셈에 넣으면 그만큼 과다 견적입니다.
    const items = scenes([{ narration: "", audio: "generated" }, { narration: "문장", audio: "none" }]);
    expect(numbers(narrationScenesToSpeak(items, [1, 2]))).toEqual([2]);
  });

  it("gives the same answer whether the caller pre-filtered by text or not", () => {
    // 두 화면이 각자 `withText` 를 이미 갖고 있어서, 넣는 쪽이 달라도 답이 같아야 합니다.
    const items = scenes([{ narration: "" }, { narration: "문장", audio: "generated" }, { narration: "문장" }]);
    expect(numbers(narrationScenesToSpeak(items, []))).toEqual(numbers(narrationScenesToSpeak(narrationScenesWithText(items), [])));
  });
});
