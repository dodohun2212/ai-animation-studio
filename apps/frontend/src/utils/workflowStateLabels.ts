import { WorkflowState } from "@ai-animation-studio/shared";
import type { ProjectType } from "@ai-animation-studio/shared";

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

/** Korean display labels for ProjectType (packages/shared/src/domain.ts). */
export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  short_project: "단편 프로젝트",
  long_story_project: "장기 프로젝트",
};

export function projectTypeLabel(type: ProjectType | string): string {
  return (PROJECT_TYPE_LABEL as Record<string, string>)[type] ?? type;
}
