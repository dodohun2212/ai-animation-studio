import type { LongProjectSettings } from "@ai-animation-studio/shared";

/**
 * 장편 이야기 칸마다 붙는 한 줄 설명 — 만들기 화면과 설정 화면이 같은 말을 하도록 한 곳에 둡니다.
 *
 * CLI Round 1199: 「한 줄 줄거리」와 「개요」, 「중간 전개」와 「스토리 흐름 요약」, 범용 「메모」가 서로 겹쳐 보여
 * 헷갈린다는 지적. 칸은 지우지 않고(전부 저장·전달되는 값입니다) 무엇이 다른지만 짧게 말합니다.
 */
export const LONG_STORY_HINTS: Partial<Record<keyof LongProjectSettings, string>> = {
  logline: "무슨 이야기인지 한 문장으로.",
  overview: "한 줄 줄거리보다 길게 — 세계, 주요 인물, 큰 갈등.",
  audience: "예: 판타지를 좋아하는 10대. 말투와 수위를 정할 때 참고합니다.",
  notes: "아래 칸 어디에도 안 맞는 그 밖의 부탁.",
  startingState: "1화가 시작될 때 주인공과 세계가 어떤 상태인지.",
  midpoint: "이야기 한가운데서 판을 뒤집는 사건 하나.",
  endingDirection: "어떻게 끝나면 좋을지.",
  storyFlowSummary: "처음부터 끝까지 흐름을 몇 줄로 — 시작·중간·결말을 이어서.",
};

/** 접힌 묶음 제목 옆에 적을 「몇 칸 적음」. 다 비었으면 그렇다고 말합니다. */
export function filledCountLabel(values: ReadonlyArray<string>): string {
  const filled = values.filter((value) => value.trim().length > 0).length;
  return filled === 0 ? "비워 둬도 됩니다" : `${filled}칸 적음`;
}
