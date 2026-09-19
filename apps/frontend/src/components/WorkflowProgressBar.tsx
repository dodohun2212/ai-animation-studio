import { WorkflowState } from "@ai-animation-studio/shared";

import { workflowStateTone } from "../utils/workflowStateLabels.js";

// The fixed product pipeline order (docs/01_CURRENT_PRODUCT_SPEC.md's "고정 흐름").
// INTERRUPTED isn't on this line (it only ever happens mid video-generation), so it's
// mapped to the same point as GENERATING_VIDEOS rather than getting its own slot.
const PIPELINE_ORDER: WorkflowState[] = [
  WorkflowState.Init,
  WorkflowState.Ready,
  WorkflowState.GeneratingStory,
  WorkflowState.WaitingForAssetMappingReview,
  WorkflowState.AssetMappingApproved,
  WorkflowState.GeneratingImages,
  WorkflowState.ImagesReady,
  WorkflowState.ImagesReview,
  WorkflowState.WaitingForVideoConfirmation,
  WorkflowState.GeneratingVideos,
  WorkflowState.VideosReady,
  WorkflowState.ReviewingVideos,
  WorkflowState.VideosApproved,
  WorkflowState.Rendering,
  WorkflowState.Completed,
];

export function progressPercent(state: WorkflowState): number {
  if (state === WorkflowState.Failed || state === WorkflowState.Cancelled) return 100;
  const resolved = state === WorkflowState.Interrupted ? WorkflowState.GeneratingVideos : state;
  const index = PIPELINE_ORDER.indexOf(resolved);
  if (index < 0) return 0;
  return Math.round((index / (PIPELINE_ORDER.length - 1)) * 100);
}

/**
 * 더 갈 데가 없는 상태 — 끝났거나, 실패했거나, 취소된 것.
 *
 * 🔴 `progressPercent` 는 이 셋에 전부 100 을 돌려주고, **그건 그대로 맞습니다** — 남은 거리가 0이니까요.
 * 틀린 건 그 100 을 막대로 그리는 쪽이었습니다: 꽉 찬 막대는 「거의 다 왔다」와 생김새가 같고, 목록에서는
 * 화면에서 제일 진한 색이 **정보를 하나도 싣지 않은 자리**를 차지합니다. 캡틴D가 「눈이 아프다」고 한
 * 목록이 정확히 그 줄무늬였습니다.
 *
 * 그래서 계산은 그대로 두고 **그리는 쪽에서만** 끊습니다. 퍼센트가 필요한 다른 곳(정렬·집계)은 영향이
 * 없고, 「끝난 것에는 막대가 없다」는 규칙은 부르는 화면마다 다시 쓰지 않아도 됩니다.
 */
export function isPipelineOver(state: WorkflowState): boolean {
  return state === WorkflowState.Completed
    || state === WorkflowState.Failed
    || state === WorkflowState.Cancelled;
}

/**
 * A thin visual readout of how far a project has moved through the fixed pipeline.
 *
 * 🔴 끝난 프로젝트에는 **아무것도 그리지 않습니다**(`isPipelineOver`). 상태는 옆의 칩이 글자로 말하고
 * 있고, 막대는 「얼마나 남았나」에만 답합니다 — 남은 게 없으면 할 말이 없는 것이 맞습니다.
 */
export function WorkflowProgressBar({ state, className = "" }: { state: WorkflowState; className?: string }) {
  if (isPipelineOver(state)) return null;
  const percent = progressPercent(state);
  // 디자인 톤 B: 진짜로 지금 돌아가고 있는 단계(§2.1의 progress 톤과 같은 기준)에만 바 위로 반짝임이
  // 지나간다 — 대기 중인 바는 정지해 있다. StatusChip의 깜빡이는 점과 같은 기준을 쓴다.
  const live = workflowStateTone(state) === "progress";
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="진행률"
      className={`h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07] ${className}`.trim()}
    >
      <div
        className={`h-full rounded-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.6)] ${live ? "bar-live" : ""}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
