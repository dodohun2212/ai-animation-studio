import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { StoryPromptService, renderTemplate } from "./story-prompt.service.js";
import { generateLocalStory, validateStory } from "./story-generation.service.js";
import { WorkflowState } from "@ai-animation-studio/shared";

const roots: string[] = [];
async function setup() {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-prompt-")); roots.push(root);
  const templateRoot = path.join(root, "templates"); await fsPromises.mkdir(path.join(templateRoot, "story"), { recursive: true });
  await fsPromises.writeFile(path.join(templateRoot, "story", "story_generation.txt"), "name=$project_name topic=$topic count=$scene_count literal=$$ missing=$missing", "utf8");
  const repository = new LocalProjectRepository(path.join(root, "projects"));
  const stored = createStoredProject("sample", "night sky", "2026-08-22T00:00:00.000Z");
  stored.character_profile = { name: "hero", cast: [{ asset_id: "CHAR-1" }] };
  stored.lore_context = { project_name: "Stars", duration_seconds: 30, scene_count: 6 };
  await repository.create(stored);
  return { repository, templateRoot, service: new StoryPromptService(repository, templateRoot) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fsPromises.rm(root, { recursive: true, force: true }))); });

describe("StoryPromptService", () => {
  it("renders an exact local preview with six scenes and no provider call", async () => {
    const { service } = await setup();
    const result = await service.preview("sample");
    expect(result.preview).toMatchObject({ projectId: "sample", originalPrompt: "name=Stars topic=night sky count=6 literal=$ missing=$missing", characterCount: 1, sceneCount: 6 });
    expect(result.preview.originalPromptSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("persists only the approved exact text and detects a stale preview", async () => {
    const { repository, service } = await setup(); const preview = await service.preview("sample");
    const approved = await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "  edited prompt  ", approved: true });
    expect(approved).toMatchObject({ prompt: "edited prompt", modified: true });
    const persisted = await repository.findById("sample");
    expect(persisted.lore_context).toMatchObject({ story_prompt_request: { actual_prompt: "edited prompt", original_prompt: preview.preview.originalPrompt, modified: true, model: "local-fake-story-adapter" } });
    expect(persisted).toMatchObject({ workflow_state: WorkflowState.WaitingForAssetMappingReview, script_revision: 1 });
    expect(persisted.story).toMatchObject({ title: "night sky — Local Story" });
    expect(persisted.scenes).toHaveLength(6);
    expect(persisted.scenes.map((scene) => (scene as { number: number }).number)).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(service.approve("sample", { originalPromptSha256: "a".repeat(64), prompt: "x", approved: true })).rejects.toMatchObject({ response: { code: "STORY_PROMPT_STALE" } });
  });
  it("rejects blank, unapproved, and unknown approval fields", async () => {
    const { service } = await setup(); const preview = await service.preview("sample");
    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: " ", approved: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "x", approved: false })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "x", approved: true, extra: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
  it("keeps Python-style unresolved placeholders and escaped dollars", () => {
    expect(renderTemplate("$known $$ $unknown", { known: "value" })).toBe("value $ $unknown");
  });
  it("begins a new mapping review after persisting validated six-scene Story output", async () => {
    const { repository, templateRoot } = await setup();
    const beginReview = async (_projectId: string, request: unknown) => {
      expect(request).toEqual({ scriptRevision: 1 });
      return { review: { mappingRevision: 4 } };
    };
    const service = new StoryPromptService(repository, templateRoot, { beginReview } as never);
    const preview = await service.preview("sample");
    await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true });
    expect(await repository.findById("sample")).toMatchObject({
      workflow_state: WorkflowState.WaitingForAssetMappingReview,
      script_revision: 1,
      mapping_revision: 4,
    });
  });
  it("rejects generation when the approved project is no longer READY", async () => {
    const { repository, service } = await setup();
    const preview = await service.preview("sample");
    const stored = await repository.findById("sample");
    await repository.save({ ...stored, workflow_state: WorkflowState.GeneratingStory });
    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "x", approved: true }))
      .rejects.toMatchObject({ response: { code: "STORY_GENERATION_NOT_ALLOWED" } });
  });
});

describe("local Story generator", () => {
  it("produces every strict Python STORY_SCHEMA field in six ordered scenes", () => {
    const stored = createStoredProject("story", "rain", "2026-08-22T00:00:00.000Z");
    const story = generateLocalStory(stored, "approved local prompt");
    validateStory(story);
    expect(Object.keys(story).sort()).toEqual(["ending", "scenes", "synopsis", "title"]);
    expect(story.scenes).toHaveLength(6);
    story.scenes.forEach((scene, index) => {
      expect(Object.keys(scene).sort()).toEqual([
        "camera_angle", "camera_motion", "composition", "continuity_hint", "description", "end_motion", "environment_motion", "expression_change", "focus_subject", "lens_feel", "main_motion", "motion_intensity", "motion_speed", "number", "shot_size", "start_motion", "visual_action",
      ]);
      expect(scene.number).toBe(index + 1);
    });
  });
  it("rejects unknown, incomplete, and out-of-order Story output", () => {
    const valid = generateLocalStory(createStoredProject("story", "rain", "2026-08-22T00:00:00.000Z"), "approved");
    expect(() => validateStory({ ...valid, extra: true })).toThrow();
    expect(() => validateStory({ ...valid, scenes: valid.scenes.slice(0, 5) })).toThrow();
    expect(() => validateStory({ ...valid, scenes: [{ ...valid.scenes[0]!, number: 2 }, ...valid.scenes.slice(1)] })).toThrow();
    const incomplete = { ...valid.scenes[0]! } as Record<string, unknown>; delete incomplete.camera_motion;
    expect(() => validateStory({ ...valid, scenes: [incomplete, ...valid.scenes.slice(1)] })).toThrow();
  });
});
