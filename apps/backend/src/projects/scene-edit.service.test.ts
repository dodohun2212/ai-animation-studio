import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStoredProject } from "./project.mapper.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { SceneEditService } from "./scene-edit.service.js";
import { LocalProjectAssetMappingsRepository, scriptFingerprint } from "../mappings/mappings.repository.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function baseScene(number: number) {
  return {
    number, description: `d${number}`, visual_action: `a${number}`, start_motion: `s${number}`, main_motion: `m${number}`, end_motion: `e${number}`,
    shot_size: "medium", camera_angle: "eye", composition: "center", lens_feel: "natural", focus_subject: "subject",
    camera_motion: "dolly", environment_motion: "wind", motion_speed: "normal", motion_intensity: "moderate",
    expression_change: "calm", continuity_hint: "continue", narration: `narration ${number}`,
  };
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scene-edit-")); roots.push(root);
  const projectsRoot = path.join(root, "learning_data", "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("scenes", "topic", "2026-08-26T00:00:00.000Z");
  project.scenes = [1, 2, 3].map(baseScene);
  await projects.create(project);
  const service = new SceneEditService(projects, projectsRoot);
  const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
  return { root, projectsRoot, projects, service, mappings };
}

describe("SceneEditService.update — request validation", () => {
  it("rejects a body that isn't exactly { scene: {...} }", async () => {
    const { service } = await setup();
    await expect(service.update("scenes", "1", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.update("scenes", "1", { scene: {}, extra: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.update("scenes", "1", { scene: "not an object" })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects an empty edit and unknown field names", async () => {
    const { service } = await setup();
    await expect(service.update("scenes", "1", { scene: {} })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.update("scenes", "1", { scene: { number: "1" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.update("scenes", "1", { scene: { made_up_field: "x" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects a non-string field value", async () => {
    const { service } = await setup();
    await expect(service.update("scenes", "1", { scene: { narration: 123 } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects a scene number outside the project's range", async () => {
    const { service } = await setup();
    await expect(service.update("scenes", "99", { scene: { narration: "x" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.update("scenes", "0", { scene: { narration: "x" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.update("scenes", "1.5", { scene: { narration: "x" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
});

describe("SceneEditService.update — applying an edit", () => {
  it("merges the edit into the target scene without touching other scenes or other fields", async () => {
    const { service, projects } = await setup();
    const result = await service.update("scenes", "2", { scene: { narration: "새 내레이션" } });
    expect(result.project.scenes[1]).toMatchObject({ narration: "새 내레이션", description: "d2" });
    expect(result.project.scenes[0]).toMatchObject({ narration: "narration 1" });
    const reloaded = await projects.findById("scenes");
    expect(reloaded.scenes[1]).toMatchObject({ narration: "새 내레이션" });
  });

  it("accepts an edit spanning multiple whitelisted fields in one call", async () => {
    const { service } = await setup();
    const result = await service.update("scenes", "1", { scene: { focus_subject: "새 대상", end_motion: "새 종료 동작" } });
    expect(result.project.scenes[0]).toMatchObject({ focus_subject: "새 대상", end_motion: "새 종료 동작" });
  });
});

describe("SceneEditService.update — staleness", () => {
  it("reports nothing stale when no artifact has ever been generated for that scene", async () => {
    const { service } = await setup();
    const result = await service.update("scenes", "1", { scene: { narration: "새 내레이션" } });
    expect(result.staleness).toEqual({ imageStale: [], videoStale: [], narrationStale: [] });
  });

  it("flags narrationStale only, when only a narration record exists and only narration text changed", async () => {
    const { service, projects } = await setup();
    const project = await projects.findById("scenes");
    project.narration_generation_records = [{ scene_number: 1, narration: "narration 1" }];
    await projects.save(project);
    const result = await service.update("scenes", "1", { scene: { narration: "고친 내레이션" } });
    expect(result.staleness).toEqual({ imageStale: [], videoStale: [], narrationStale: [1] });
  });

  it("does not flag narrationStale when the edited narration happens to match what's already recorded", async () => {
    const { service, projects } = await setup();
    const project = await projects.findById("scenes");
    project.narration_generation_records = [{ scene_number: 1, narration: "narration 1" }];
    await projects.save(project);
    const result = await service.update("scenes", "1", { scene: { description: "새 설명" } });
    expect(result.staleness.narrationStale).toEqual([]);
  });

  it("flags imageStale when an image-bucket field changes after that scene's image was generated", async () => {
    const { service, projects } = await setup();
    const project = await projects.findById("scenes");
    const { imagePromptFor, styleLineFor } = await import("../images/image-prompt.js");
    project.image_generation_records = [{ scene_number: 1, prompt: imagePromptFor(project.scenes[0], styleLineFor(project)) }];
    await projects.save(project);
    const result = await service.update("scenes", "1", { scene: { focus_subject: "다른 대상" } });
    expect(result.staleness.imageStale).toEqual([1]);
    expect(result.staleness.videoStale).toEqual([]);
    expect(result.staleness.narrationStale).toEqual([]);
  });

  it("never flags imageStale or videoStale for a description-only edit (display field, nothing downstream reads it)", async () => {
    const { service, projects } = await setup();
    const project = await projects.findById("scenes");
    const { imagePromptFor, styleLineFor } = await import("../images/image-prompt.js");
    project.image_generation_records = [{ scene_number: 1, prompt: imagePromptFor(project.scenes[0], styleLineFor(project)) }];
    await projects.save(project);
    const result = await service.update("scenes", "1", { scene: { description: "화면 대본만 바뀜" } });
    expect(result.staleness).toEqual({ imageStale: [], videoStale: [], narrationStale: [] });
  });

  it("flags the NEXT scene's video as stale (without editing it) when end_motion or continuity_hint changes, since both feed the next scene's continuity cue", async () => {
    const { service, projects } = await setup();
    const project = await projects.findById("scenes");
    const { promptFor, ratioFor } = await import("../videos/video-preview.service.js");
    const ratio = ratioFor(project);
    const scene2Prompt = promptFor(project.scenes[1] as never, project.scenes[0] as never, ratio, 5);
    project.video_generation_records = [{ scene_number: 2, prompt: scene2Prompt }];
    await projects.save(project);

    const result = await service.update("scenes", "1", { scene: { end_motion: "완전히 다른 종료 동작" } });
    expect(result.staleness.videoStale).toEqual([2]);
  });

  it("also flags a scene's own video as stale when its own motion field changes", async () => {
    const { service, projects } = await setup();
    const project = await projects.findById("scenes");
    const { promptFor, ratioFor } = await import("../videos/video-preview.service.js");
    const ratio = ratioFor(project);
    const scene1Prompt = promptFor(project.scenes[0] as never, undefined, ratio, 5);
    project.video_generation_records = [{ scene_number: 1, prompt: scene1Prompt }];
    await projects.save(project);

    const result = await service.update("scenes", "1", { scene: { main_motion: "완전히 다른 주요 동작" } });
    expect(result.staleness.videoStale).toEqual([1]);
  });
});

describe("SceneEditService.update — mapping review fingerprint re-stamping", () => {
  it("re-stamps an approved review's fingerprint to match the edit, so it stays approved", async () => {
    const { service, projects, mappings } = await setup();
    const project = await projects.findById("scenes");
    const now = "2026-08-26T00:00:00.000Z";
    await mappings.saveReview("scenes", {
      project_id: "scenes", mapping_revision: 1, script_revision: project.script_revision,
      script_fingerprint: scriptFingerprint(project.scenes), status: "approved", approved_at: now, approved_by: "user",
      text_only_confirmed: true, legacy_confirmed: false, reviewed_scenes: [1, 2, 3],
    });

    await service.update("scenes", "1", { scene: { narration: "고친 내레이션" } });

    const reloadedProject = await projects.findById("scenes");
    const reloadedReview = await mappings.loadReview("scenes");
    expect(reloadedReview.status).toBe("approved");
    expect(reloadedReview.script_fingerprint).toBe(scriptFingerprint(reloadedProject.scenes));
  });

  it("leaves a non-approved (waiting) review's fingerprint alone", async () => {
    const { service, mappings } = await setup();
    await service.update("scenes", "1", { scene: { narration: "고친 내레이션" } });
    const review = await mappings.loadReview("scenes");
    expect(review.status).toBe("waiting");
    expect(review.script_fingerprint).toBe("");
  });
});
