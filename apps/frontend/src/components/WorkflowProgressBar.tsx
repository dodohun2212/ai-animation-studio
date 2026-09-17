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

/** A thin visual readout of how far a project has moved through the fixed pipeline — Python had an animated meter bar; this is the non-animated equivalent. */
export function WorkflowProgressBar({ state, className = "" }: { state: WorkflowState; className?: string }) {
  const failed = state === WorkflowState.Failed || state === WorkflowState.Cancelled;
  const percent = progressPercent(state);
  // 디자인 톤 B: 진짜로 지금 돌아가고 있는 단계(§2.1의 progress 톤과 같은 기준)에만 바 위로 반짝임이
  // 지나간다 — 끝났거나 대기 중인 바는 정지해 있다. StatusChip의 깜빡이는 점과 같은 기준을 쓴다.
  const live = !failed && workflowStateTone(state) === "progress";
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="진행률"
      className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-800 ${className}`.trim()}
    >
      <div
        className={`h-full rounded-full ${failed ? "bg-rose-500" : "bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.6)]"} ${live ? "bar-live" : ""}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
