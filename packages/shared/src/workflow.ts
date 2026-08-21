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
  [WorkflowState.Completed]: [],
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
