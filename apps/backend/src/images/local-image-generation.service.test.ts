import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";
import { LocalProjectAssetMappingsRepository, scriptFingerprint } from "../mappings/mappings.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalImageGenerationService } from "./local-image-generation.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-images-")); roots.push(root);
  const projectsRoot = path.join(root, "learning_data", "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("images", "moonlit garden", "2026-08-22T00:00:00.000Z");
  project.workflow_state = WorkflowState.AssetMappingApproved;
  project.script_revision = 1;
  project.mapping_revision = 3;
  project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `scene ${number}`, main_motion: `motion ${number}` }));
  await projects.create(project);
  const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
  await mappings.saveReview("images", { project_id: "images", mapping_revision: 3, script_revision: 1, script_fingerprint: scriptFingerprint(project.scenes), status: "approved", approved_at: "2026-08-22T00:00:00.000Z", approved_by: "user", text_only_confirmed: true, legacy_confirmed: false, reviewed_scenes: [1, 2, 3, 4, 5, 6] });
  return { projectsRoot, projects, mappings };
}

describe("provider-free local image generation", () => {
  it("requires explicit approval, the approved mapping state, and a current approved review", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    const service = new LocalImageGenerationService(projects, mappings, projectsRoot);
    await expect(service.generate("images", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const state = await projects.findById("images"); state.workflow_state = WorkflowState.WaitingForAssetMappingReview; await projects.save(state);
    await expect(service.generate("images", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_GENERATION_NOT_ALLOWED" } });
    state.workflow_state = WorkflowState.AssetMappingApproved; await projects.save(state);
    await mappings.saveReview("images", { ...(await mappings.loadReview("images")), script_fingerprint: "a".repeat(64) });
    await expect(service.generate("images", { approved: true })).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_REVIEW_REQUIRED" } });
  });

  it("writes six sequential valid PNGs, snake_case checkpoints and ends in IMAGES_REVIEW", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    const result = await new LocalImageGenerationService(projects, mappings, projectsRoot).generate("images", { approved: true });
    expect(result.generatedSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.reusedSceneNumbers).toEqual([]);
    expect(result.project.workflowState).toBe(WorkflowState.ImagesReview);
    const reloaded = await new LocalProjectRepository(projectsRoot).findById("images");
    expect(reloaded).toMatchObject({ workflow_state: WorkflowState.ImagesReview });
    expect(reloaded.generated_images).toHaveLength(6);
    expect(reloaded.image_prompts).toEqual(["scene 1", "scene 2", "scene 3", "scene 4", "scene 5", "scene 6"]);
    expect(reloaded.motion_prompts).toEqual(["motion 1", "motion 2", "motion 3", "motion 4", "motion 5", "motion 6"]);
    expect(reloaded.image_generation_records).toEqual(expect.arrayContaining([expect.objectContaining({ scene_number: 1, checkpoint: "completed", image_api_calls: 0 })]));
    await Promise.all(reloaded.generated_images.map(async (file, index) => {
      expect(file).toBe(path.join(projectsRoot, "images", "images", `scene${index + 1}.png`));
      expect((await fs.readFile(file)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }));
    const assets = await new LocalAssetsRepository(path.dirname(projectsRoot)).list();
    const folder = assets.find((asset) => asset.is_folder && asset.source_project_id === "images");
    expect(folder?.child_asset_ids).toHaveLength(6);
    expect(folder?.approved).toBe(false);
    expect(assets.filter((asset) => !asset.is_folder && asset.source_project_id === "images")).toHaveLength(6);
  });

  it("preserves checkpoints on failure and a new instance generates only missing images", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    let writes = 0;
    const failing = new LocalImageGenerationService(projects, mappings, projectsRoot, async (file, bytes) => {
      writes += 1;
      if (writes === 3) throw new Error("disk failure");
      await fs.writeFile(file, bytes);
    });
    await expect(failing.generate("images", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_STORAGE_ERROR" } });
    const partial = await projects.findById("images");
    expect(partial.workflow_state).toBe(WorkflowState.AssetMappingApproved);
    expect(partial.generated_images).toHaveLength(2);
    expect(await fs.stat(partial.generated_images[0]!)).toMatchObject({ isFile: expect.any(Function) });
    const resumed = await new LocalImageGenerationService(new LocalProjectRepository(projectsRoot), new LocalProjectAssetMappingsRepository(projectsRoot), projectsRoot).generate("images", { approved: true });
    expect(resumed.reusedSceneNumbers).toEqual([1, 2]);
    expect(resumed.generatedSceneNumbers).toEqual([3, 4, 5, 6]);
    expect((await new LocalProjectRepository(projectsRoot).findById("images")).workflow_state).toBe(WorkflowState.ImagesReview);
  });

  it("does not duplicate generated Asset IDs after restart and full reuse", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    await new LocalImageGenerationService(projects, mappings, projectsRoot).generate("images", { approved: true });
    const assets = new LocalAssetsRepository(path.dirname(projectsRoot));
    const before = (await assets.list()).map((asset) => asset.asset_id).sort();
    const project = await projects.findById("images");
    project.workflow_state = WorkflowState.AssetMappingApproved;
    await projects.save(project);
    const resumed = await new LocalImageGenerationService(new LocalProjectRepository(projectsRoot), new LocalProjectAssetMappingsRepository(projectsRoot), projectsRoot)
      .generate("images", { approved: true });
    expect(resumed.reusedSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await assets.list()).map((asset) => asset.asset_id).sort()).toEqual(before);
  });
});
