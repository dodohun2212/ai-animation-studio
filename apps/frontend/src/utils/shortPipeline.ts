import { WorkflowState } from "@ai-animation-studio/shared";

export type ShortPipelineStepName =
  | "storyPrompt"
  | "mappingReview"
  | "imageGeneration"
  | "videoPreview"
  | "videoWorkflow"
  | "videoMerge";

/**
 * The fixed product pipeline, named by what happens at each step.
 *
 * Moved here out of App.tsx so the sidebar column and the project screen's ribbon read one list. Two copies of
 * six labels is two places to rename a step and one place to forget — the same shape as the scene-count
 * duplication 캡틴D found on the flower form, and cheaper to prevent than to notice.
 *
 * Three of these once had "영상" in them and one was called "워크플로우" — a category word, not a step — so the
 * last three read as one thing split into three for no visible reason. They are before / during / after the
 * paid Runway call, and the names say that.
 */
export const SHORT_PROJECT_PIPELINE: { name: ShortPipelineStepName; label: string }[] = [
  { name: "storyPrompt", label: "대본" },
  { name: "mappingReview", label: "참고 이미지 연결" },
  { name: "imageGeneration", label: "장면 이미지" },
  { name: "videoPreview", label: "영상 보내기 전 확인" },
  { name: "videoWorkflow", label: "영상 만들어지는 중" },
  { name: "videoMerge", label: "최종 영상 합치기" },
];

/**
 * How far the project itself has actually got, as an index into {@link SHORT_PROJECT_PIPELINE}. `-1` means
 * nothing has started.
 *
 * Several states share a step because they are phases of the same one (making images, images ready, reviewing
 * images are all 장면 이미지). Failure states light nothing: whatever the run reached, it is not a position the
 * person can read progress from.
 *
 * 🔴 Not derived from `resumeTarget`, though the two look interchangeable. That answers "which screen continues
 * this project" and this answers "how far did it get" — they differ at INIT, where there is a next step (대본)
 * and no distance travelled. Lit dots that count a step nobody has taken is the same defect as the pipeline
 * column that used to fill in from the screen being viewed.
 */
export const PIPELINE_REACH: Readonly<Record<WorkflowState, number>> = {
  [WorkflowState.Init]: -1,
  [WorkflowState.Ready]: 0,
  [WorkflowState.GeneratingStory]: 0,
  [WorkflowState.WaitingForAssetMappingReview]: 1,
  [WorkflowState.AssetMappingApproved]: 2,
  [WorkflowState.GeneratingImages]: 2,
  [WorkflowState.ImagesReady]: 2,
  [WorkflowState.ImagesReview]: 2,
  [WorkflowState.WaitingForVideoConfirmation]: 3,
  [WorkflowState.GeneratingVideos]: 4,
  [WorkflowState.Interrupted]: 4,
  [WorkflowState.VideosReady]: 4,
  [WorkflowState.ReviewingVideos]: 4,
  [WorkflowState.VideosApproved]: 5,
  [WorkflowState.Rendering]: 5,
  [WorkflowState.Completed]: 5,
  [WorkflowState.Failed]: -1,
  [WorkflowState.Cancelled]: -1,
};
