import { IMAGE_FAILURE_SCOPES, SCENE_FAILURE_REMEDIES, isSceneNumber, type ImageFailureScope, type SceneFailureRemedy } from "@ai-animation-studio/shared";

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

/**
 * The sentence an image failure gets, built from the one error that carries the answer (docs/00_NOW.md ②-2).
 *
 * Image generation is one synchronous request, so a failure arrives as an error and nothing reads the progress
 * afterwards — everything the person needs has to be in this string. What ② asks for is where it stopped, what
 * already exists, and what pressing the button again would do; `ImageGenerationFailureDetails` carries all three.
 *
 * 🔴 Every part is conditional, and with no details this returns exactly today's sentence. A response from a
 * build that predates the field must not turn into a claim about a scene number or about the budget.
 *
 * 🔴 `remedy` is used only when present, never defaulted through `sceneRemedyAdvice(undefined)`. The contract
 * leaves it out for `authentication` and `quota_or_permission` precisely because all three of its sentences are
 * about the scene's input, and there the category's own sentence ("check the key") is the true advice. Passing
 * `undefined` in would print the hedged input sentence over a bad key — the wrong answer, stated confidently.
 *
 * 🟠 The budget line says the month counted it, not that the provider charged. The ledger records every paid
 * image call at its estimate whether it succeeded or not; what OpenAI did with a refused call is not visible to
 * this app, and saying otherwise would be a claim we cannot support.
 */
export function imageFailureMessage(categoryMessage: string, details: Record<string, unknown> | undefined): string {
  const scene = typeof details?.sceneNumber === "number" ? details.sceneNumber : undefined;
  /* 🔴 Checked against the contract's list, not cast from any string. A value we do not recognise is not a
     remedy — and passing it through to `sceneRemedyAdvice` would land on its `default`, which is the hedged
     input sentence this function deliberately withholds when the contract omits `remedy`. A typo or a newer
     server would then print 「무엇을 바꿀지 적어 주세요」 over a bad key: the confident wrong answer, arriving
     through the one door left open. */
  const remedy = (SCENE_FAILURE_REMEDIES as readonly string[]).includes(details?.remedy as string)
    ? (details!.remedy as SceneFailureRemedy)
    : undefined;
  const parts: string[] = [];
  /* 🔴 `scope` decides which of the two sentences is true, and the Long Episode is why it has to.
     There, a whole run and one scene's redraw come back under the SAME error code, so the code cannot tell
     them apart — and 「${scene}번부터 이어서 만듭니다」 is simply false for a redraw: nothing continues, the
     other scenes were never touched, and the button says 「N번 다시 만들기」. Telling someone their run will
     resume when it will not is worse than saying nothing about it.

     Unknown or missing scope drops the scene sentence entirely rather than guessing which one applies —
     the same rule `remedy` follows two lines down, and for the same reason: a confident wrong sentence is
     worse than a quiet one. */
  const scope = (IMAGE_FAILURE_SCOPES as readonly string[]).includes(details?.scope as string)
    ? (details!.scope as ImageFailureScope)
    : undefined;
  if (scene !== undefined && isSceneNumber(scene) && scope) {
    parts.push(scope === "run"
      ? `${scene}번 장면에서 멈췄습니다. 그 앞 장면 그림은 저장돼 있어, 다시 만들면 ${scene}번부터 이어서 만듭니다.`
      : `${scene}번 장면을 다시 그리지 못했습니다. 다른 장면은 그대로입니다.`);
  }
  parts.push(categoryMessage);
  if (remedy) parts.push(sceneRemedyAdvice(remedy));
  if (details?.billedOnFailure === true) {
    parts.push("실패한 이 장면도 이번 달 예산에는 쓴 것으로 계상됐습니다.");
  }
  return parts.join(" ");
}
