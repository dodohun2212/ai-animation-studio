import { WorkflowState } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

import { parseStoredProject } from "./project-storage.schema.js";

function baseProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: "sample_project",
    topic: "우주를 여행하는 고양이",
    workflow_state: "READY",
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
    project_type: "short_project",
    scenes: [],
    warnings: [],
    errors: [],
    final_video_path: null,
    ...overrides,
  };
}

describe("parseStoredProject", () => {
  it("parses a minimal valid stored project and fills documented defaults", () => {
    const stored = parseStoredProject(baseProject());
    expect(stored.project_id).toBe("sample_project");
    expect(stored.topic).toBe("우주를 여행하는 고양이");
    expect(stored.character_profile).toEqual({});
    expect(stored.image_prompts).toEqual([]);
    expect(stored.script_revision).toBe(0);
  });

  it("accepts Python's UTC offset timestamp format alongside JS's Z suffix", () => {
    const stored = parseStoredProject(
      baseProject({ created_at: "2026-08-21T00:00:00.123456+00:00" }),
    );
    expect(stored.created_at).toBe("2026-08-21T00:00:00.123456+00:00");
  });

  it("preserves known Python compatibility fields it does not use", () => {
    const stored = parseStoredProject(
      baseProject({
        character_profile: { name: "고양이" },
        lore_context: { lore: "자율" },
        style_profile: { genre: "sci-fi" },
        references: [{ id: "ref-1" }],
        story: { title: "제목" },
        image_prompts: ["p1"],
        motion_prompts: ["m1"],
        generated_images: ["scene1.png"],
        image_generation_records: [{ scene: 1 }],
        generated_image_reviews: [{ scene: 1 }],
        face_consistency_results: [{ scene: 1 }],
        generated_video_paths: ["scene1.mp4"],
        video_generation_records: [{ scene: 1 }],
        video_reviews: [{ scene: 1 }],
        capcut_clip_paths: [],
        generated_narrations: ["scene1.mp3", null],
        narration_generation_records: [{ scene: 1 }],
        api_usage: [{ provider: "openai" }],
        script_revision: 2,
        mapping_revision: 1,
      }),
    );
    expect(stored.character_profile).toEqual({ name: "고양이" });
    expect(stored.image_prompts).toEqual(["p1"]);
    expect(stored.generated_narrations).toEqual(["scene1.mp3", null]);
    expect(stored.narration_generation_records).toEqual([{ scene: 1 }]);
    expect(stored.api_usage).toEqual([{ provider: "openai" }]);
    expect(stored.script_revision).toBe(2);
    expect(stored.mapping_revision).toBe(1);
  });

  it("rejects a non-object root", () => {
    expect(() => parseStoredProject([])).toThrow();
    expect(() => parseStoredProject("not an object")).toThrow();
    expect(() => parseStoredProject(null)).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() => parseStoredProject(baseProject({ totally_unknown_field: 1 }))).toThrow();
  });

  it("rejects a project_type other than short_project", () => {
    expect(() => parseStoredProject(baseProject({ project_type: "long_story_project" }))).toThrow();
  });

  it("rejects a workflow_state outside the shared WorkflowState enum", () => {
    expect(() => parseStoredProject(baseProject({ workflow_state: "NOT_A_STATE" }))).toThrow();
  });

  it("rejects a malformed timestamp", () => {
    expect(() => parseStoredProject(baseProject({ created_at: "not-a-date" }))).toThrow();
    expect(() => parseStoredProject(baseProject({ created_at: "2026-08-21T00:00:00+09:00" }))).toThrow();
  });

  it("rejects a field with the wrong JSON type", () => {
    expect(() => parseStoredProject(baseProject({ topic: 123 }))).toThrow();
    expect(() => parseStoredProject(baseProject({ warnings: "not-an-array" }))).toThrow();
    expect(() => parseStoredProject(baseProject({ character_profile: [] }))).toThrow();
    expect(() => parseStoredProject(baseProject({ script_revision: "0" }))).toThrow();
  });

  it("accepts up to MAX_SCENE_COUNT (12) items in a bounded array field, but rejects more", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => String(index + 1));
    expect(() => parseStoredProject(baseProject({ image_prompts: twelve }))).not.toThrow();
    expect(() => parseStoredProject(baseProject({ image_prompts: [...twelve, "13"] }))).toThrow();
  });

  it("remaps legacy WAITING_FOR_CAPCUT and CAPCUT_CLIPS_READY workflow states", () => {
    const waiting = parseStoredProject(baseProject({ workflow_state: "WAITING_FOR_CAPCUT" }));
    expect(waiting.workflow_state).toBe(WorkflowState.WaitingForVideoConfirmation);

    const ready = parseStoredProject(baseProject({ workflow_state: "CAPCUT_CLIPS_READY" }));
    expect(ready.workflow_state).toBe(WorkflowState.VideosReady);
  });

  it("backfills generated_video_paths from capcut_clip_paths when only the legacy field is set", () => {
    const stored = parseStoredProject(
      baseProject({ capcut_clip_paths: ["scene1.mp4"], generated_video_paths: [] }),
    );
    expect(stored.generated_video_paths).toEqual(["scene1.mp4"]);
  });

  it("does not override generated_video_paths when it is already populated", () => {
    const stored = parseStoredProject(
      baseProject({
        capcut_clip_paths: ["legacy.mp4"],
        generated_video_paths: ["current.mp4"],
      }),
    );
    expect(stored.generated_video_paths).toEqual(["current.mp4"]);
  });
});
