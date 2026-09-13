import type { NarrationAudioState, SceneNumber } from "@ai-animation-studio/shared";

/**
 * 두 내레이션 화면(짧은 프로젝트 · 긴 에피소드)이 **살 것을 세는** 한 곳.
 *
 * 🔴 실제로 **말해질** 장면만 셉니다 — 값이 붙은 수라서.
 *
 * 확인 상자는 「이미 음성이 있는 장면은 다시 만들지 않아 비용도 들지 않습니다」라고 말하면서, 바로 아래
 * 줄에서 **그 장면들까지 곱하고** 있었습니다. 두 줄이 서로를 부정하면 사람은 둘 다 못 믿습니다.
 *
 * 그리고 이 수는 장식이 아닙니다 — `BudgetLine` 에 `estimatedRequestCostUsd` 로 그대로 들어갑니다. 많이
 * 부르면 **낼 수 있는 돈인데도 예산에 걸려 막힙니다.** 과다 견적이 「안전한 쪽」이 아닌 이유입니다.
 *
 * 규칙은 백엔드가 실제로 쓰는 것과 같게 뒀습니다 — `local-narration-generation.service.ts` 와
 * `episode-narration.service.ts` 의 `stillGoodAudio`: 기록의 문장이 지금 문장과 같고 · 가짜 음성이 아니고 ·
 * 파일이 멀쩡할 때만 재사용. 즉 **음성이 `generated` 가 아니거나(없음·자리표시), 글이 바뀌어 뒤처진 장면**이
 * 말해집니다. 두 서비스가 같은 규칙이라 두 화면도 같은 함수를 씁니다 — 한쪽만 고쳐지는 일이 없도록.
 *
 * 🔴 `narrationStale` 이 안 왔을 때는 **전부 센다**로 되돌아갑니다. 모르면서 적게 부르면 그게 위험한
 * 방향입니다 — 사람이 예산 안이라고 믿고 눌렀다가 중간에 막힙니다.
 */
export interface NarrationBillingItem {
  sceneNumber: SceneNumber;
  narration: string;
  audio: NarrationAudioState;
}

/** 문장이 있는 장면만. 빈 칸은 만들 것도 없고 청구도 없습니다. */
export function narrationScenesWithText<T extends NarrationBillingItem>(items: readonly T[]): T[] {
  return items.filter((item) => item.narration.trim());
}

/**
 * 이번에 실제로 **합성될** 장면. `narrationScenesWithText` 를 먼저 통과시킨 목록을 넣어도 되고 원본을 넣어도
 * 같은 답이 나옵니다(안에서 한 번 더 거릅니다).
 */
export function narrationScenesToSpeak<T extends NarrationBillingItem>(
  items: readonly T[],
  narrationStale: readonly SceneNumber[] | undefined,
): T[] {
  return narrationScenesWithText(items).filter(
    (item) => narrationStale === undefined || item.audio !== "generated" || narrationStale.includes(item.sceneNumber),
  );
}
