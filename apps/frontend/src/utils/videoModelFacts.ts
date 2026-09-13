import type { VideoFrameShape, VideoModelOption } from "@ai-animation-studio/shared";
import { VIDEO_MODEL_OPTIONS, videoSceneEstimatedCostUsd } from "@ai-animation-studio/shared";

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

/* ────────────────────────────────────────────────────────────────────────────
   이 모델 × 지금 설정
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 왜 이게 따로 있는가 — 카드는 모델의 성질을 **나열**하고, 이건 그 성질을 **지금 설정과 대조**합니다. 둘은
 * 다른 일입니다. 2026-09-13 에 캡틴D 는 「이 모델은 장면 그림의 비율을 그대로 따릅니다 — 띠가 생길 수 있습니다」를
 * 화면에서 읽고, 그대로 눌렀고, 띠가 붙은 릴을 받았습니다. 문장은 맞았습니다. 틀린 것은 그 문장이 **성질 설명**의
 * 자리에 있었다는 점입니다 — 스무 줄짜리 목록에서 한 줄은 읽히지 않습니다.
 *
 * 그리고 길이는 더 나쁩니다: 설정 길이가 모델 최대를 넘으면 어댑터가 유료 호출 직전에 거부하는데
 * (`runway-video-adapter.ts`), 그 사실을 아는 화면은 「작업 워크플로우」뿐이고 **승인 버튼이 있는 화면은
 * 아무 말도 하지 않습니다.** 총액까지 멀쩡히 보여 준 뒤 네 장면이 한꺼번에 실패합니다.
 */
export interface VideoSetupIssue {
  id: "duration" | "ratio" | "chain";
  /** `blocking` 은 「눌러도 전송 자체가 거부된다」입니다 — 경고가 아니라 잠금. */
  severity: "blocking" | "warning";
  text: string;
}

export interface VideoSetup {
  /** 장면 하나의 길이(초) — 카탈로그가 아니라 이번 요청이 실제로 들고 있는 값. */
  durationSeconds: number;
  sceneCount: number;
}

export function videoSetupIssues(option: VideoModelOption, setup: VideoSetup): VideoSetupIssue[] {
  const issues: VideoSetupIssue[] = [];

  if (setup.durationSeconds > option.maxDurationSeconds) {
    issues.push({
      id: "duration",
      severity: "blocking",
      text: `장면 길이 ${setup.durationSeconds}초는 ${option.label}의 최대 ${option.maxDurationSeconds}초를 넘습니다 — 이대로 누르면 전송이 거부되고 영상이 하나도 안 나옵니다.`,
    });
  }

  /* `requested` 만 비율을 실제로 받습니다. 나머지 둘은 「받지 않는다」가 같고, 확실한지만 다릅니다 — 그 차이를
     문장에 둡니다(하나는 생깁니다, 하나는 생길 수 있습니다). */
  if (option.frameShape === "follows_first_frame") {
    issues.push({
      id: "ratio",
      severity: "warning",
      text: `${option.label}은(는) 비율 설정을 쓰지 않고 장면 그림의 비율을 그대로 내보냅니다 — 완성본 위아래에 띠가 생깁니다.`,
    });
  } else if (option.frameShape === "unconfirmed") {
    issues.push({
      id: "ratio",
      severity: "warning",
      text: `${option.label}이(가) 어떤 비율로 내보내는지는 확인되지 않았습니다 — 완성본 위아래에 띠가 생길 수 있습니다.`,
    });
  }

  /* 장면이 하나뿐이면 이어 붙일 컷이 없습니다 — 그때 이 경고는 참이지만 쓸모가 없고, 쓸모없는 경고는 옆의
     경고까지 같이 안 읽히게 만듭니다. */
  if (!option.acceptsLastFrame && setup.sceneCount > 1) {
    issues.push({
      id: "chain",
      severity: "warning",
      text: `${option.label}은(는) 끝 그림을 받지 못합니다 — 장면이 바뀔 때 컷이 뒤로 돌아갈 수 있습니다.`,
    });
  }

  return issues;
}

export const hasBlockingIssue = (issues: readonly VideoSetupIssue[]): boolean =>
  issues.some((issue) => issue.severity === "blocking");

/**
 * 같은 설정에서 **아무 문제도 없는** 모델들, 이 요청 기준으로 싼 것부터.
 *
 * 🔴 「고르세요」가 아니라 「이런 것도 있습니다」입니다. 문제를 말해 놓고 답을 안 주면, 읽는 사람은 스무 줄짜리
 * 설정 화면으로 건너가 직접 비교해야 합니다 — 오늘 캡틴D 가 한 일이 정확히 그것이고, 그래서 띠가 나왔습니다.
 *
 * 🔴 값은 `videoSceneEstimatedCostUsd` 로 **이 요청의 길이·장면 수**에 맞춰 계산합니다. 초당 요율만 비교하면
 * 최소 청구액이 붙는 모델(Mini·2.5)에서 실제보다 싸게 보입니다.
 */
export function suggestedVideoModels(current: VideoModelOption, setup: VideoSetup, limit = 3): VideoModelOption[] {
  return VIDEO_MODEL_OPTIONS
    .filter((option) => option.id !== current.id && videoSetupIssues(option, setup).length === 0)
    .sort((a, b) => videoSceneEstimatedCostUsd(setup.durationSeconds, a) - videoSceneEstimatedCostUsd(setup.durationSeconds, b))
    .slice(0, limit);
}

/** 이 요청 전체를 그 모델로 보냈을 때의 값 — 장면당이 아니라 총액이라야 옆의 총액과 비교가 됩니다. */
export const videoSetupTotalUsd = (option: VideoModelOption, setup: VideoSetup): number =>
  videoSceneEstimatedCostUsd(setup.durationSeconds, option) * setup.sceneCount;

/* ────────────────────────────────────────────────────────────────────────────
   스무 줄을 다루는 법
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * 한 장면 값 — 목록을 값순으로 세울 때 쓰는 기준.
 *
 * 🔴 `pricePerSecondUsd` 로 정렬하면 안 됩니다. 최소 청구액이 붙는 모델(Mini · 2.5)과 장면당 요금이 붙는
 * 모델(Gemini · Grok)은 초당 요율 순서와 실제 값 순서가 다릅니다 — 요율로 세운 「싼 것부터」는 제일 싼 줄이
 * 제일 싸지 않은 목록이고, 그건 값을 보라고 만든 목록이 값에 대해 거짓말하는 것입니다.
 */
export const videoModelSceneUsd = (option: VideoModelOption, seconds = 5): number =>
  videoSceneEstimatedCostUsd(seconds, option);

/**
 * 스무 줄에서 찾는 법 — 고르는 이유별로 거릅니다.
 *
 * 🔴 「전부」가 기본값이고, 기본값일 때 화면은 지금과 한 글자도 다르지 않습니다. 거르기가 기본으로 켜져 있으면
 * 사람은 자기가 못 보는 모델이 있다는 걸 모릅니다 — 목록에서 빠진 것은 없는 것으로 읽힙니다.
 *
 * 두 조건은 이 앱이 실제로 겪은 두 실패에서 나왔습니다: 끝 그림을 못 받는 모델로 이어지는 릴을 만들면 컷이
 * 뒤로 돌아가고(788), 비율을 안 받는 모델로 만들면 완성본에 띠가 붙습니다(2026-09-13 실측).
 */
/**
 * 합치기 직전, 이 모양의 클립이 릴 틀에서 어떻게 되는가 — 세 갈래 전부.
 *
 * 🔴 처음엔 `requested` 만 참인 **참/거짓**이었습니다. 그러면 `unconfirmed` 가 `follows_first_frame` 과 같은
 * 칸에 들어가, 안 재 본 모델(`h3_max_480p`)에 대해 화면이 「띠가 남습니다」라고 **단정**합니다. 경고 쪽으로
 * 틀린 것이라 해는 작지만, 이 저장소가 세 값을 만든 이유가 바로 「근거 없는 단정을 안 한다」였습니다 —
 * 그리고 보내기 전 화면(`videoSetupIssues`)은 이미 「생깁니다 / 생길 수 있습니다」로 가르고 있어서, 참/거짓
 * 하나를 두면 **같은 릴에 대해 두 화면의 확신이 달라집니다.** (CLI Round 816 지적. 제가 두 라운드 전에
 * `generatesAudio` 를 두고 똑같은 주장을 해 놓고 여기서 참/거짓을 썼습니다.)
 *
 * 🔴 `Record` 라 네 번째 모양이 생기면 여기서 컴파일 오류가 납니다 — 조용히 한 갈래가 빠지는 대신에.
 */
export const FRAME_FIT_NOTES: Record<VideoFrameShape, { text: string; bars: boolean }> = {
  requested: { text: "릴 틀에 맞는 모양입니다 — 어느 쪽을 골라도 띠가 없습니다.", bars: false },
  follows_first_frame: { text: "릴 틀과 다른 모양입니다 — 「여백 두기」로 합치면 띠가 남습니다.", bars: true },
  unconfirmed: { text: "어떤 모양으로 나오는지 확인되지 않았습니다 — 「여백 두기」로 합치면 띠가 남을 수 있습니다.", bars: true },
};

export const VIDEO_MODEL_FILTERS = ["all", "last_frame", "exact_ratio"] as const;
export type VideoModelFilter = (typeof VIDEO_MODEL_FILTERS)[number];

export const VIDEO_MODEL_FILTER_LABELS: Record<VideoModelFilter, string> = {
  all: "전부",
  last_frame: "컷이 이어지는 것",
  exact_ratio: "비율이 지켜지는 것",
};

export function matchesVideoModelFilter(option: VideoModelOption, filter: VideoModelFilter): boolean {
  if (filter === "last_frame") return option.acceptsLastFrame;
  if (filter === "exact_ratio") return option.frameShape === "requested";
  return true;
}

export const VIDEO_MODEL_SORTS = ["catalogue", "price"] as const;
export type VideoModelSort = (typeof VIDEO_MODEL_SORTS)[number];

export const VIDEO_MODEL_SORT_LABELS: Record<VideoModelSort, string> = {
  catalogue: "기본 순서",
  price: "싼 값부터",
};

/**
 * 보여 줄 줄들 — 거르고, 세우고, **고른 것은 절대 빼지 않습니다.**
 *
 * 🔴 마지막 조건이 핵심입니다. 거르기가 지금 쓰는 모델을 숨기면 라디오 묶음에서 켜진 칸이 사라져, 사람은
 * 「내가 뭘 쓰고 있는지」를 화면에서 잃습니다. 고른 것은 조건에 안 맞아도 남고, 안 맞는다는 사실은 그 줄에
 * 이미 적혀 있는 경고가 말합니다.
 */
export function visibleVideoModels(
  options: readonly VideoModelOption[],
  selected: string,
  filter: VideoModelFilter,
  sort: VideoModelSort,
): VideoModelOption[] {
  const kept = options.filter((option) => option.id === selected || matchesVideoModelFilter(option, filter));
  return sort === "price" ? [...kept].sort((a, b) => videoModelSceneUsd(a) - videoModelSceneUsd(b)) : kept;
}
