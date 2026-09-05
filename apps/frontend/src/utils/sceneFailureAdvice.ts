import type { SceneFailureRemedy } from "@ai-animation-studio/shared";

/**
 * What the provider's answer means for pressing 다시 시도, in the person's words.
 *
 * Every fallback used to end in "잠시 후 다시 시도해 주세요", including for the one code whose documented cause
 * is the input itself. On 2026-09-05 that advice was followed twice and charged twice for nothing. `remedy` is
 * the field that tells the three cases apart, so a screen stops giving one answer to three questions.
 *
 * 🔴 One module, both video pipelines. The short project and the Episode show the same failures from the same
 * provider through the same contract field, and three sentences kept in two files are three sentences that
 * drift — the copy this repository has met all week. The per-category message tables stay where they are:
 * those really are per-pipeline, because they name what each one's own server said.
 *
 * 🔴 `undefined` is "this response carried no failure detail", never "safe to retry". It keeps the hedged
 * sentence the screens used before the contract existed: true whichever case it turns out to be, which is the
 * only thing that can be said without the field.
 */
export function sceneRemedyAdvice(remedy: SceneFailureRemedy | undefined): string {
  switch (remedy) {
    case "retry":
      return "일시적인 문제일 수 있습니다 — 바꾸지 않고 그대로 다시 보내도 됩니다.";
    case "change_input":
      return "같은 요청을 그대로 다시 보내면 다시 실패합니다. 입력 자체가 원인이라, 아래에 무엇을 바꿀지 적어야 결과가 달라집니다.";
    case "not_retryable":
      return "이 실패는 같은 요청으로는 통과하지 않습니다. 장면 대본이나 참고 이미지를 바꾼 뒤에 다시 만들어야 합니다.";
    default:
      return "바꾼 것 없이 같은 요청을 그대로 다시 보내면 같은 이유로 다시 실패할 수 있습니다 — 아래에 무엇을 바꿀지 적어 주세요.";
  }
}
