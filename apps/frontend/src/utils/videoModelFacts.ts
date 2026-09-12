import type { VideoFrameShape, VideoModelOption } from "@ai-animation-studio/shared";
import { videoSceneEstimatedCostUsd } from "@ai-animation-studio/shared";

/**
 * What is known about one video model, as sentences — in one place, because two screens say it.
 *
 * 🔴 This file exists because of a bug shape this repository keeps paying for: a sentence written twice, changed
 * once. `VideoModelCard` (고르는 화면) and `VideoPromptPreviewScreen` (돈 나가기 직전 확인 화면) describe the same
 * model, and the second is the one a person reads while deciding to spend. If the picker said 「끝 그림을 받습니다」
 * and the confirmation screen said something older, the screen that matters would be the stale one. Every sentence
 * about a model now has exactly one home and both screens read it.
 *
 * 🔴 Nothing here invents a fact. Every line is derived from `VIDEO_MODEL_OPTIONS` — the catalogue whose prices and
 * capabilities came from Runway's own pricing page and OpenAPI document (see that constant's doc comment). A model
 * fact that is not in the contract does not get a sentence here.
 */

/**
 * The whole price of one scene, in one line, with nothing left for the reader to work out.
 *
 * 🔴 Exported so the pair can assert the row contains exactly this. The format lives in one place; a test
 * that rebuilt the sentence itself would agree with a card that had stopped saying it.
 *
 * 🔴 The two optional halves are the reason this is no longer a template literal inline. `pricePerSecondUsd`
 * alone stopped being the price: Gemini and Grok add a flat charge per scene, and Mini and 2.5 never bill below
 * a floor. Both were already in every quote the moment the contract carried them — `videoSceneEstimatedCostUsd`
 * folds them in — so the numbers on this card were right and the *explanation* was missing. That gap is its own
 * failure: 「1초당 $0.10」 beside 「5초 장면 $0.51」 is a card a person checks with a calculator, disagrees with,
 * and stops trusting.
 */
export function videoModelPriceLine(option: VideoModelOption): string {
  const perSecond = `1초당 $${option.pricePerSecondUsd.toFixed(2)}`;
  // Immediately after the rate, because it is what makes the rate alone wrong.
  const perScene = option.perGenerationUsd === undefined ? "" : ` + 장면당 $${option.perGenerationUsd.toFixed(2)}`;
  const scenes = ` · 5초 장면 $${videoSceneEstimatedCostUsd(5, option).toFixed(2)} · 10초 장면 $${videoSceneEstimatedCostUsd(10, option).toFixed(2)}`;
  /* Worded as what it does, not as its name. Both clip lengths this app offers already clear every floor in the
     catalogue, so this number never appears in the two totals beside it — which is precisely why it has to be
     said out loud rather than inferred from them. */
  const minimum = option.minimumChargeUsd === undefined ? "" : ` · 짧아도 최소 $${option.minimumChargeUsd.toFixed(2)}`;
  return `${perSecond}${perScene}${scenes}${minimum}`;
}

/**
 * Whose shape the finished clip keeps — and, for two of the three answers, what that does to the reel.
 *
 * 🔴 A `Record` over the contract's own union, so a fourth shape is a compile error here rather than a row that
 * quietly says nothing. `null` is a real answer and not a hole: for `requested` there is nothing to warn about,
 * and twelve of twenty rows carrying a reassuring sentence would bury the four that matter.
 *
 * 🔴 `unconfirmed` gets its own sentence rather than silence, and that is the whole point of asking for a
 * three-valued field. Silence there reads as 「괜찮다」 to anyone comparing rows, which is the reassuring
 * direction — the wrong one to be wrong in. It also happens to be the model 캡틴D's first reel is planned on
 * (H3 Max), so the one row where 「확인 안 됨」 must be said is the one row somebody is about to press.
 */
export const FRAME_SHAPE_NOTES: Record<VideoFrameShape, string | null> = {
  requested: null,
  follows_first_frame:
    "이 모델은 장면 그림의 비율을 그대로 따릅니다 — 그림이 릴 비율과 다르면 완성본 위아래에 띠가 생길 수 있습니다.",
  unconfirmed:
    "이 모델이 어떤 비율로 내보내는지는 확인되지 않았습니다 — 완성본 위아래에 띠가 생길 수 있습니다.",
};

/**
 * 🔴 조건을 붙인 문장입니다. 이 칸이 생겼을 때 앱은 끝 프레임을 **한 장도 안 보내고** 있었습니다 — 모델의 능력만
 * 적어 두고 앱이 그걸 쓰는지는 아무도 안 적어서, 읽는 사람이 「이 모델을 고르면 이어진다」로 받아들였습니다.
 * 캡틴D 께 H3 Max 를 권한 근거도 이 줄이었고, 그때 그 말은 참이 아니었습니다(Cowork 788 → CLI 789 에서 실제로
 * 보내게 됨). 지금은 **「장면 이어 그리기」가 켜진 프로젝트에서만** 참이라, 그 조건을 문장에 넣습니다 — 보통
 * 이야기의 장면은 일부러 끊는 컷이라 끝 프레임을 안 보냅니다.
 *
 * The one line here that is not a number, and the reason the picker exists at all. A person choosing between two
 * models is choosing between two reels; price tells them what it costs and this tells them what they get. Worded
 * as what happens in the reel, never as the field name — 「끝 프레임」 means nothing to someone who has not read
 * the adapter.
 */
export function videoModelLastFrameLine(option: VideoModelOption): string {
  return option.acceptsLastFrame
    ? "「장면 이어 그리기」를 켠 프로젝트에서는, 앞 클립이 끝난 그 그림에서 다음 클립이 시작합니다 — 이어지는 릴에 좋습니다."
    : "앞 클립이 끝난 장면을 이어받지 못합니다 — 성장·이동처럼 계속 이어지는 릴에서는 컷이 뒤로 돌아갈 수 있습니다.";
}

/**
 * What happens to whatever sound the model produces — the same answer for every model, so it is a line about the
 * app rather than a field on the option.
 *
 * 🔴 Read out of the merge, not assumed: `ffmpeg-merge.service.ts` maps `0:v:0` from each clip and nothing else,
 * then maps either that scene's narration file or `anullsrc` (silence), and the background music is mixed onto
 * *that* stream. Both scene branches and the music pass do it; the concat that follows is `-c copy`. So a clip's
 * own audio never reaches the finished reel, whatever the model generated.
 *
 * 🔴 And that is a money line, not a feature line. Some Runway models bill for audio work; here it would be paid
 * for and then dropped on the floor. Said next to the price for that reason.
 *
 * 🔴 What is deliberately NOT said is which models generate sound at all. Runway's pricing page does not state it
 * per model (checked 2026-09-13; only Seedance 2.5's "reference images and audio are free" touches it, and that is
 * about inputs), and this repository does not put a model fact on screen without a source — a wrong 「소리 있음」
 * would be exactly the reassuring-direction error the frame-shape field exists to avoid.
 */
export const VIDEO_CLIP_AUDIO_NOTE =
  "영상 AI 가 만든 소리는 완성본에 들어가지 않습니다 — 소리는 내레이션과 배경 음악으로만 만듭니다.";

/** A fact worth a line, and whether it is a warning. `caution` is the amber the picker already uses. */
export interface VideoModelFact {
  text: string;
  tone: "plain" | "caution";
}

/**
 * Everything the catalogue knows about a model, as the lines a confirmation screen should show — in the order a
 * person needs them: what it does to the reel, how long a clip may be, and then whatever cannot be promised.
 *
 * 🔴 An empty `ratios` is a real answer, not missing data. Runway's own SDK types give some models on this
 * endpoint no ratio field at all (h3_max takes a `resolution` instead), and the contract's list is then empty.
 * Joined blindly that printed 「비율  · 한 장면 최대 15초」, which reads as a bug in the product rather than a
 * property of the model — so the line drops the half it cannot state and keeps the half it can.
 */
export function videoModelFacts(option: VideoModelOption): VideoModelFact[] {
  const shapeNote = FRAME_SHAPE_NOTES[option.frameShape];
  return [
    { text: videoModelLastFrameLine(option), tone: option.acceptsLastFrame ? "plain" : "caution" },
    {
      text: `${option.ratios.length > 0 ? `비율 ${option.ratios.join(" · ")} · ` : ""}한 장면 최대 ${option.maxDurationSeconds}초`,
      tone: "plain",
    },
    ...(shapeNote === null ? [] : [{ text: shapeNote, tone: "caution" as const }]),
  ];
}
