import type { Project } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { PHOTO_CARD_STEPS } from "./photoCardSteps.js";

/**
 * The product flow has exactly one next screen for any project state, and until now only ProjectDetail knew it.
 * Every other screen ended at 「프로젝트로 돌아가기」, so continuing meant going back to the project and reading
 * the flow off a button there — 캡틴D asked for the step to be reachable from where they already were.
 *
 * Kept in one place on purpose: two screens that each decide the next step will eventually disagree about it,
 * the way ProjectList and the archive list disagreed about what 실패 looks like before workflowStateTone moved
 * here.
 */
export type ResumeTarget =
  | { screen: "storyPrompt"; label: string }
  | { screen: "mappingReview"; label: string }
  | { screen: "imageGeneration"; label: string }
  | { screen: "videoPreview"; label: string }
  | { screen: "videoWorkflow"; jobId: string; label: string }
  | { screen: "videoMerge"; label: string };

/** Maps a project's current workflow state to the single screen that continues it, matching the fixed product flow. */
/** `label` is the complete button text — each case phrases its own lead-in, since "이어서 진행하기" only fits an in-progress state, not a finished one. */
export function resumeTarget(project: Project): ResumeTarget | null {
  /**
   * A card is written straight to VideosApproved, but nothing stops it being read at an earlier state, and the
   * switch below would then send the reader to 대본 지시문 확인 — a screen the router answers with "명언 카드에는
   * 없는 단계입니다". Merging is the card's actual first step.
   *
   * 🔴 This early return was lost when the switch moved out of ProjectDetail into this file: the switch was
   * visible and came along, the guard above it was not and did not. The lesson is the one this file now carries
   * in its own history — when logic moves, the dangerous lines are the ones that are not the thing you moved.
   *
   * 🔴 And it happened again one layer in. The block was restored as a single return, which lost the two
   * conditions inside it: a finished card was told to 「이어서 진행하기」 about work that is done, and a failed
   * or cancelled card was offered a button at all. The `label` comment above says 「이어서 진행하기」 only fits
   * an in-progress state — the code had started contradicting its own documentation. Restored from 31c5281.
   */
  if (project.photoCard === true) {
    // Failed and cancelled keep the null the switch would have given them: there is nothing to continue.
    if (project.workflowState === WorkflowState.Failed || project.workflowState === WorkflowState.Cancelled) return null;
    return project.workflowState === WorkflowState.Completed
      ? { screen: "videoMerge", label: "최종 영상 결과 보기" }
      : { screen: "videoMerge", label: `이어서 진행하기 · ${PHOTO_CARD_STEPS[0].label}` };
  }
  switch (project.workflowState) {
    case WorkflowState.Init:
    case WorkflowState.Ready:
    case WorkflowState.GeneratingStory:
      return { screen: "storyPrompt", label: "이어서 진행하기 · 대본 지시문 확인" };
    case WorkflowState.WaitingForAssetMappingReview:
      return { screen: "mappingReview", label: "이어서 진행하기 · 참고 이미지 연결 검토" };
    case WorkflowState.AssetMappingApproved:
    case WorkflowState.GeneratingImages:
    case WorkflowState.ImagesReady:
    case WorkflowState.ImagesReview:
      return { screen: "imageGeneration", label: "이어서 진행하기 · 장면 이미지 생성/검토" };
    case WorkflowState.WaitingForVideoConfirmation:
      return { screen: "videoPreview", label: "이어서 진행하기 · 영상 프롬프트 및 비용 확인" };
    case WorkflowState.GeneratingVideos:
    case WorkflowState.VideosReady:
    case WorkflowState.ReviewingVideos:
    case WorkflowState.Interrupted:
      return project.currentVideoJobId
        ? { screen: "videoWorkflow", jobId: project.currentVideoJobId, label: "이어서 진행하기 · 영상 생성/검토" }
        : { screen: "videoPreview", label: "이어서 진행하기 · 영상 프롬프트 및 비용 확인" };
    case WorkflowState.VideosApproved:
    case WorkflowState.Rendering:
      return { screen: "videoMerge", label: "이어서 진행하기 · 최종 영상 병합" };
    case WorkflowState.Completed:
      // Nothing left to do, but the finished result should still be reachable to watch again
      // or open in Explorer — VideoMergeScreen shows the existing video instead of re-merging.
      return { screen: "videoMerge", label: "최종 영상 결과 보기" };
    default:
      // Failed / Cancelled have no next step to resume into.
      return null;
  }
}
