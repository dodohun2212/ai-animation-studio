import { WorkflowState } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

import { createStoredProject, toApiProject, toApiSummary } from "./project.mapper.js";

describe("createStoredProject", () => {
  it("starts a fresh project at READY with every Python default field populated", () => {
    const stored = createStoredProject("sample_project", "우주를 여행하는 고양이", "2026-08-21T00:00:00.000Z");

    expect(stored.project_id).toBe("sample_project");
    expect(stored.topic).toBe("우주를 여행하는 고양이");
    expect(stored.workflow_state).toBe(WorkflowState.Ready);
    expect(stored.created_at).toBe("2026-08-21T00:00:00.000Z");
    expect(stored.updated_at).toBe("2026-08-21T00:00:00.000Z");
    expect(stored.project_type).toBe("short_project");
    expect(stored.scenes).toEqual([]);
    expect(stored.character_profile).toEqual({});
    expect(stored.final_video_path).toBeNull();
    expect(stored.script_revision).toBe(0);
    expect(stored.mapping_revision).toBe(0);
  });
});

describe("toApiSummary / toApiProject", () => {
  it("maps snake_case storage fields to camelCase API fields without a userId", () => {
    const stored = createStoredProject("sample_project", "우주를 여행하는 고양이", "2026-08-21T00:00:00.000Z");

    const summary = toApiSummary(stored);
    expect(summary).toEqual({
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      workflowState: WorkflowState.Ready,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    });
    expect("userId" in summary).toBe(false);

    const project = toApiProject(stored);
    expect(project).toEqual({
      ...summary,
      scenes: [],
      warnings: [],
      errors: [],
    });
    expect("finalVideoPath" in project).toBe(false);
  });

  it("includes finalVideoPath only when the stored value is not null", () => {
    const stored = createStoredProject("sample_project", "topic", "2026-08-21T00:00:00.000Z");
    stored.final_video_path = "videos/final/instagram_reel.mp4";

    const project = toApiProject(stored);
    expect(project.finalVideoPath).toBe("videos/final/instagram_reel.mp4");
  });

  it("passes each stored scene's narration through to the API scene untouched, and omits it when absent", () => {
    const stored = createStoredProject("sample_project", "topic", "2026-08-21T00:00:00.000Z");
    stored.scenes = [{ number: 1, description: "d", narration: "narration line" }, { number: 2, description: "d2" }];

    const project = toApiProject(stored);
    expect(project.scenes[0]?.narration).toBe("narration line");
    expect("narration" in project.scenes[1]!).toBe(false);
  });

  it("computes script from each scene's description, motionPrompt/generatedImagePath/generatedVideoPath from the index-aligned arrays, and omits them when absent", () => {
    const stored = createStoredProject("sample_project", "topic", "2026-08-21T00:00:00.000Z");
    stored.scenes = [{ number: 1, description: "scene one text" }, { number: 2, description: "scene two text" }];
    stored.motion_prompts = ["scene one motion"];
    stored.generated_images = ["images/scene1.png"];
    stored.generated_video_paths = ["", "videos/scene2.mp4"];

    const project = toApiProject(stored);

    expect(project.scenes[0]).toMatchObject({ script: "scene one text", motionPrompt: "scene one motion", generatedImagePath: "images/scene1.png" });
    expect("generatedVideoPath" in project.scenes[0]!).toBe(false);

    expect(project.scenes[1]).toMatchObject({ script: "scene two text", generatedVideoPath: "videos/scene2.mp4" });
    expect("motionPrompt" in project.scenes[1]!).toBe(false);
    expect("generatedImagePath" in project.scenes[1]!).toBe(false);
  });

  it("omits currentVideoJobId when no video generation record exists", () => {
    const stored = createStoredProject("sample_project", "topic", "2026-08-21T00:00:00.000Z");
    expect("currentVideoJobId" in toApiProject(stored)).toBe(false);
  });

  it("exposes the most recently appended video generation record's job_id as currentVideoJobId", () => {
    const stored = createStoredProject("sample_project", "topic", "2026-08-21T00:00:00.000Z");
    stored.video_generation_records = [
      { scene_number: 1, job_id: "job-old" },
      { scene_number: 1, job_id: "job-new" },
    ];
    expect(toApiProject(stored).currentVideoJobId).toBe("job-new");
  });

  it("ignores malformed video generation records when deriving currentVideoJobId", () => {
    const stored = createStoredProject("sample_project", "topic", "2026-08-21T00:00:00.000Z");
    stored.video_generation_records = ["not-an-object", { job_id: 123 }, null];
    expect("currentVideoJobId" in toApiProject(stored)).toBe(false);
  });
});
