export enum WorkflowState {
  Init = "INIT",
  Ready = "READY",
  GeneratingStory = "GENERATING_STORY",
  WaitingForAssetMappingReview = "WAITING_FOR_ASSET_MAPPING_REVIEW",
  AssetMappingApproved = "ASSET_MAPPING_APPROVED",
  GeneratingImages = "GENERATING_IMAGES",
  ImagesReady = "IMAGES_READY",
  ImagesReview = "IMAGES_REVIEW",
  WaitingForVideoConfirmation = "WAITING_FOR_VIDEO_CONFIRMATION",
  GeneratingVideos = "GENERATING_VIDEOS",
  VideosReady = "VIDEOS_READY",
  ReviewingVideos = "REVIEWING_VIDEOS",
  VideosApproved = "VIDEOS_APPROVED",
  Interrupted = "INTERRUPTED",
  Rendering = "RENDERING",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Cancelled = "CANCELLED",
}

const terminalStates = [
  WorkflowState.Completed,
  WorkflowState.Failed,
  WorkflowState.Cancelled,
] as const;

/**
 * Documents the intended shape of the pipeline — nothing in this codebase calls canTransition() or
 * assertWorkflowTransition() at runtime today (`.claude-bridge` Round 171: found while designing the video
 * library's restore()), so a project.json write that skips this table is not actually rejected anywhere. Keep it
 * honest anyway: a reader who trusts this table as authoritative and is wrong about that reaches worse
 * conclusions than a reader who knows to go check the code directly (the same day's aspect-ratio-size bug,
 * review-thumbnail bug, and PROVIDER_SETTINGS_ROOT bug were all one place trusting a assumption/comment another
 * place had already stopped matching).
 *
 * Completed -> VideosApproved: video-library.service.ts's restore() reopens a Completed project this way when a
 * scene version is restored, so a stale final video is actually re-mergeable rather than a label the user can
 * never act on. Deliberately not "Completed has some outgoing transitions now, therefore drop it from
 * terminalStates below" — Completed is still where the normal pipeline ends; restore is a distinct, explicit
 * user action reopening it, not a continuation of the automatic pipeline terminalStates describes.
 */
export const WORKFLOW_TRANSITIONS: Readonly<
  Record<WorkflowState, readonly WorkflowState[]>
> = {
  [WorkflowState.Init]: [WorkflowState.Ready, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.Ready]: [WorkflowState.GeneratingStory, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.GeneratingStory]: [WorkflowState.WaitingForAssetMappingReview, WorkflowState.GeneratingImages, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.WaitingForAssetMappingReview]: [WorkflowState.AssetMappingApproved, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.AssetMappingApproved]: [WorkflowState.GeneratingImages, WorkflowState.WaitingForAssetMappingReview, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.GeneratingImages]: [WorkflowState.ImagesReady, WorkflowState.AssetMappingApproved, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.ImagesReady]: [WorkflowState.ImagesReview, WorkflowState.WaitingForVideoConfirmation, WorkflowState.GeneratingImages, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.ImagesReview]: [WorkflowState.WaitingForVideoConfirmation, WorkflowState.GeneratingImages, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.WaitingForVideoConfirmation]: [WorkflowState.GeneratingVideos, WorkflowState.GeneratingImages, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.GeneratingVideos]: [WorkflowState.VideosReady, WorkflowState.Interrupted, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.VideosReady]: [WorkflowState.ReviewingVideos, WorkflowState.GeneratingVideos, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.ReviewingVideos]: [WorkflowState.VideosApproved, WorkflowState.GeneratingVideos, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.VideosApproved]: [WorkflowState.Rendering, WorkflowState.GeneratingVideos, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.Interrupted]: [WorkflowState.GeneratingVideos, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.Rendering]: [WorkflowState.Completed, WorkflowState.Failed, WorkflowState.Cancelled],
  [WorkflowState.Completed]: [WorkflowState.VideosApproved],
  [WorkflowState.Failed]: [],
  [WorkflowState.Cancelled]: [],
};

export function canTransition(current: WorkflowState, next: WorkflowState): boolean {
  return WORKFLOW_TRANSITIONS[current].includes(next);
}

export function assertWorkflowTransition(current: WorkflowState, next: WorkflowState): void {
  if (!canTransition(current, next)) {
    throw new Error(`Invalid workflow transition: ${current} -> ${next}`);
  }
}

export function isTerminalState(state: WorkflowState): boolean {
  return terminalStates.includes(state as (typeof terminalStates)[number]);
}
