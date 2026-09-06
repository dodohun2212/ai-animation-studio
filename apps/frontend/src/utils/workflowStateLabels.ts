import { WorkflowState } from "@ai-animation-studio/shared";
import type { ProjectType } from "@ai-animation-studio/shared";

import type { StatusTone } from "../components/ui/StatusChip.js";

/** Korean display labels for WorkflowState (packages/shared/src/workflow.ts), used on the short-project screens. */
export const WORKFLOW_STATE_LABEL: Record<WorkflowState, string> = {
  [WorkflowState.Init]: "초기화",
  [WorkflowState.Ready]: "준비됨",
  [WorkflowState.GeneratingStory]: "스토리 생성 중",
  [WorkflowState.WaitingForAssetMappingReview]: "에셋 매핑 검토 대기",
  [WorkflowState.AssetMappingApproved]: "에셋 매핑 승인됨",
  [WorkflowState.GeneratingImages]: "이미지 생성 중",
  [WorkflowState.ImagesReady]: "이미지 준비됨",
  [WorkflowState.ImagesReview]: "이미지 검토 중",
  [WorkflowState.WaitingForVideoConfirmation]: "영상 생성 확인 대기",
  [WorkflowState.GeneratingVideos]: "영상 생성 중",
  [WorkflowState.VideosReady]: "영상 준비됨",
  [WorkflowState.ReviewingVideos]: "영상 검토 중",
  [WorkflowState.Interrupted]: "중단됨",
  [WorkflowState.VideosApproved]: "영상 승인됨",
  [WorkflowState.Rendering]: "렌더링 중",
  [WorkflowState.Completed]: "완료",
  [WorkflowState.Failed]: "실패",
  [WorkflowState.Cancelled]: "취소됨",
};

export function workflowStateLabel(state: WorkflowState): string {
  return WORKFLOW_STATE_LABEL[state] ?? state;
}

/**
 * The same mapping's other half: workflow state → status-chip tone, per the design system's fixed grammar
 * (§2.1/§3.4). Emerald only for a genuinely finished project, amber while something is running, rose on
 * failure, neutral for the waiting and review steps. `Ready` is deliberately neutral — it means "set up, not
 * started", not "done".
 *
 * It lives beside the label rather than inside one screen because a second screen now shows the same states,
 * and a copied tone table is how two lists come to disagree about what "실패" looks like.
 */
export function workflowStateTone(state: WorkflowState): StatusTone {
  if (state === WorkflowState.Failed || state === WorkflowState.Cancelled) return "danger";
  if (state === WorkflowState.Completed) return "success";
  if (state === WorkflowState.Interrupted) return "progress";
  if (
    state === WorkflowState.GeneratingStory || state === WorkflowState.GeneratingImages
    || state === WorkflowState.GeneratingVideos || state === WorkflowState.Rendering
  ) return "progress";
  return "neutral";
}

/** Korean display labels for ProjectType (packages/shared/src/domain.ts). */
export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  short_project: "단편 프로젝트",
  long_story_project: "장기 프로젝트",
};

export function projectTypeLabel(type: ProjectType | string): string {
  return (PROJECT_TYPE_LABEL as Record<string, string>)[type] ?? type;
}
