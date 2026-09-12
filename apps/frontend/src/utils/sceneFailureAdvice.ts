import { IMAGE_FAILURE_SCOPES, SCENE_FAILURE_REMEDIES, isSceneNumber, type ImageFailureScope, type MergeFailedDetails, type SceneFailureRemedy } from "@ai-animation-studio/shared";

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
interface SceneFailureSentences {
  /** A multi-scene run that stopped here — what survived, and what pressing the button again does. */
  run: (scene: number) => string;
  /** One scene redone on its own — nothing continues, nothing else moved. */
  scene: (scene: number) => string;
}

const IMAGE_SENTENCES: SceneFailureSentences = {
  run: (scene) => `${scene}번 장면에서 멈췄습니다. 그 앞 장면 그림은 저장돼 있어, 다시 만들면 ${scene}번부터 이어서 만듭니다.`,
  scene: (scene) => `${scene}번 장면을 다시 그리지 못했습니다. 다른 장면은 그대로입니다.`,
};

/**
 * The same two sentences for narration, and only the noun differs — which is the whole argument for sharing
 * everything above them rather than writing a second composer.
 *
 * 🔴 「음성은 저장돼 있다」 is the half that pays for this. A narration run is one paid TTS call per scene, so a
 * person who cannot see that scenes 1–6 already exist presses 「처음부터」 and buys those six again. That is the
 * same shape ②-2 closed for images, on a pipeline that bills per scene rather than per run.
 */
const NARRATION_SENTENCES: SceneFailureSentences = {
  run: (scene) => `${scene}번 장면에서 멈췄습니다. 그 앞 장면 음성은 저장돼 있어, 다시 만들면 ${scene}번부터 이어서 만듭니다.`,
  scene: (scene) => `${scene}번 장면 음성을 다시 만들지 못했습니다. 다른 장면은 그대로입니다.`,
};

/**
 * One composer, two vocabularies.
 *
 * 🔴 Everything that can go wrong here is in the conditions, not in the wording: which sentence `scope` picks,
 * whether `remedy` is a value the contract actually publishes, whether a missing field turns into a claim. Those
 * were each got wrong once already (762 cast instead of checked · 763 promised a resume for a redraw · 766 left
 * five fixtures behind), and every one of them would have had to be got right twice if narration had its own
 * copy. The nouns are the only part that differs, so the nouns are the only part that is passed in.
 */
function sceneFailureMessage(
  categoryMessage: string,
  details: Record<string, unknown> | undefined,
  sentences: SceneFailureSentences,
): string {
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
    parts.push(scope === "run" ? sentences.run(scene) : sentences.scene(scene));
  }
  parts.push(categoryMessage);
  if (remedy) parts.push(sceneRemedyAdvice(remedy));
  if (details?.billedOnFailure === true) {
    parts.push("실패한 이 장면도 이번 달 예산에는 쓴 것으로 계상됐습니다.");
  }
  return parts.join(" ");
}

/** The image pipelines' sentence — short project and Long Episode alike. */
export function imageFailureMessage(categoryMessage: string, details: Record<string, unknown> | undefined): string {
  return sceneFailureMessage(categoryMessage, details, IMAGE_SENTENCES);
}

/** The narration pipelines' sentence. Same conditions, same guarantees; 「그림」 becomes 「음성」. */
export function narrationFailureMessage(categoryMessage: string, details: Record<string, unknown> | undefined): string {
  return sceneFailureMessage(categoryMessage, details, NARRATION_SENTENCES);
}

/* ------------------------------------------------------------------------------------------------------------
 * 합치기 — the last step, and the one that used to say the least.
 * ---------------------------------------------------------------------------------------------------------- */

type MergeFailureStage = MergeFailedDetails["stage"];

/**
 * Where inside FFmpeg the render stopped, said as what to look at next.
 *
 * 🔴 A `Record` over the union's own discriminant — `MergeFailedDetails["stage"]`, not three strings typed out
 * here. A fourth stage is then a compile error in this table rather than a value that silently gets no sentence,
 * and the runtime check below reads THIS table's keys, so there is no second list to drift. Same defect family as
 * `server_error` (769) and the two Runway tables that claimed to be identical copies (770); the difference is
 * that here it cannot be written down twice in the first place.
 *
 * Each sentence names the thing to look at, because that is what separates the stages for the person: a scene
 * stage points at one clip, a music stage points at the audio they chose and leaves the clips alone.
 */
const MERGE_STAGE_SENTENCES: Record<MergeFailureStage, (scene: number | undefined) => string> = {
  scene: (scene) => scene === undefined
    ? "한 장면 클립을 화면 틀에 맞추는 단계에서 멈췄습니다."
    : `${scene}번 장면 클립을 화면 틀에 맞추는 단계에서 멈췄습니다 — 먼저 그 장면 영상을 확인해 주세요.`,
  join: () => "틀에 맞춘 클립들을 이어 붙이는 단계에서 멈췄습니다.",
  // The one stage whose cause is something the person chose on this very screen, so it says so.
  music: () => "배경음을 입히는 단계에서 멈췄습니다 — 음악 파일이나 시작 지점을 바꿔 다시 시도해 보세요.",
};

/**
 * The merge-failed sentence: which step, then the fixed text about what survived.
 *
 * 🔴 Conditional all the way down, for the reason `imageFailureMessage` is. A build that sends no `details`
 * reads exactly as it did, and an unknown `stage` drops the step sentence rather than guessing — the 766 rule.
 * Naming the wrong step is not cosmetic here: 「N번 장면」 sends someone to re-make a clip that is fine, which
 * on a paid model is money. It is also why FFMPEG_UNAVAILABLE keeps its own code and never reaches this
 * function — the render never started, so no step is the answer (CLI Round 778).
 */
export function mergeFailureMessage(baseMessage: string, details: Record<string, unknown> | undefined): string {
  const stage = details?.stage;
  const known = typeof stage === "string" && Object.prototype.hasOwnProperty.call(MERGE_STAGE_SENTENCES, stage)
    ? (stage as MergeFailureStage)
    : undefined;
  if (!known) return baseMessage;
  const scene = typeof details?.sceneNumber === "number" && isSceneNumber(details.sceneNumber) ? details.sceneNumber : undefined;
  return `${MERGE_STAGE_SENTENCES[known](scene)} ${baseMessage}`;
}

/**
 * Which scenes stopped the merge before FFmpeg was ever asked.
 *
 * 🔴 Twelve scenes opened by hand is what this error cost before (769). The list is used only when there is at
 * least one entry and every entry is a real scene number — an empty array is the server saying it could not
 * tell, and 「번 장면」 with nothing in front of it is worse than the general sentence it replaced.
 */
export function mergeClipsInvalidMessage(
  baseMessage: string,
  details: Record<string, unknown> | undefined,
  /** Where to go next, in the words that pipeline's own screen uses. The list replaces only the naming half. */
  sceneTail: string,
): string {
  const raw = details?.sceneNumbers;
  if (!Array.isArray(raw) || raw.length === 0) return baseMessage;
  if (!raw.every((value) => typeof value === "number" && isSceneNumber(value))) return baseMessage;
  const scenes = [...new Set(raw as number[])].sort((a, b) => a - b);
  return `${scenes.join("·")}번 장면 영상을 확인할 수 없습니다. ${sceneTail}`;
}
