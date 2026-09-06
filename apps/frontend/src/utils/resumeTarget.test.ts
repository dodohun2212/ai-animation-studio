import { describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { makeProject } from "../api/testUtils.js";
import { resumeTarget } from "./resumeTarget.js";

describe("resumeTarget", () => {
  it("names the one next screen for each stage of the flow", () => {
    const at = (workflowState: WorkflowState) => resumeTarget(makeProject({ workflowState }));

    expect(at(WorkflowState.Ready)?.screen).toBe("storyPrompt");
    expect(at(WorkflowState.WaitingForAssetMappingReview)?.screen).toBe("mappingReview");
    expect(at(WorkflowState.ImagesReview)?.screen).toBe("imageGeneration");
    expect(at(WorkflowState.WaitingForVideoConfirmation)?.screen).toBe("videoPreview");
    expect(at(WorkflowState.VideosApproved)?.screen).toBe("videoMerge");
  });

  /**
   * The branch that was lost when this logic moved out of ProjectDetail — the switch came along, the guard
   * above it did not. A card has no story steps, so an unfinished one answers with the merge screen.
   *
   * 🔴 The three states this list did not cover are the three the branch treats differently, which is why the
   * restored version passed while still being wrong: 「every state answers with the merge screen」 was a new
   * claim, not the old behaviour. They are covered below now.
   */
  it("sends an unfinished 명언 카드 to the merge screen, never into a story step", () => {
    for (const workflowState of [WorkflowState.Ready, WorkflowState.WaitingForAssetMappingReview, WorkflowState.VideosApproved]) {
      const target = resumeTarget(makeProject({ photoCard: true, workflowState }));
      expect(target).toMatchObject({ screen: "videoMerge" });
      expect(target?.label).toBe("이어서 진행하기 · 자막·음악 정하고 영상 만들기");
    }
  });

  /** 「이어서 진행하기」 only fits an in-progress state — the label comment in resumeTarget.ts says so, and a
   * finished card was being told to continue work that is done. It goes to the same screen by a different name. */
  it("offers a finished 명언 카드 its result, not a step to continue", () => {
    const target = resumeTarget(makeProject({ photoCard: true, workflowState: WorkflowState.Completed }));

    expect(target).toMatchObject({ screen: "videoMerge" });
    expect(target?.label).toBe("최종 영상 결과 보기");
  });

  /** There is nothing to continue, so there is no button — the same answer the switch gives every other project. */
  it("offers a failed or cancelled 명언 카드 nothing at all", () => {
    for (const workflowState of [WorkflowState.Failed, WorkflowState.Cancelled]) {
      expect(resumeTarget(makeProject({ photoCard: true, workflowState }))).toBeNull();
    }
  });

  it("carries the running job into the video workflow screen, and falls back to the preview without one", () => {
    const running = resumeTarget(makeProject({ workflowState: WorkflowState.GeneratingVideos, currentVideoJobId: "job-1" }));
    expect(running).toMatchObject({ screen: "videoWorkflow", jobId: "job-1" });
    // A project left mid-video with no job to rejoin has to go back through the preview, not into a job screen
    // with no job — the same fallback ProjectDetail has always applied.
    expect(resumeTarget(makeProject({ workflowState: WorkflowState.GeneratingVideos }))?.screen).toBe("videoPreview");
  });

  it("still offers the finished video, but stops calling it 이어서 진행하기", () => {
    const done = resumeTarget(makeProject({ workflowState: WorkflowState.Completed }));
    expect(done?.screen).toBe("videoMerge");
    expect(done?.label).not.toContain("이어서 진행하기");
  });

  it("offers nothing for a project that has no next step", () => {
    expect(resumeTarget(makeProject({ workflowState: WorkflowState.Failed }))).toBeNull();
    expect(resumeTarget(makeProject({ workflowState: WorkflowState.Cancelled }))).toBeNull();
  });
});
