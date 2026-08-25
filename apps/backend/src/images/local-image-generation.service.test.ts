import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";
import { LocalProjectAssetMappingsRepository, scriptFingerprint } from "../mappings/mappings.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { LocalImageGenerationService } from "./local-image-generation.service.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-images-")); roots.push(root);
  const projectsRoot = path.join(root, "learning_data", "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("images", "moonlit garden", "2026-08-22T00:00:00.000Z");
  project.workflow_state = WorkflowState.AssetMappingApproved;
  project.script_revision = 1;
  project.mapping_revision = 3;
  project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({
    number, description: `scene ${number}`, main_motion: `motion ${number}`, visual_action: `action ${number}`,
    shot_size: "medium shot", camera_angle: "eye level", composition: `composition ${number}`, lens_feel: "natural", focus_subject: "subject",
  }));
  await projects.create(project);
  const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
  await mappings.saveReview("images", { project_id: "images", mapping_revision: 3, script_revision: 1, script_fingerprint: scriptFingerprint(project.scenes), status: "approved", approved_at: "2026-08-22T00:00:00.000Z", approved_by: "user", text_only_confirmed: true, legacy_confirmed: false, reviewed_scenes: [1, 2, 3, 4, 5, 6] });
  return { root, projectsRoot, projects, mappings };
}

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=";
function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

async function setupWithConnectedOpenAi() {
  const base = await setup();
  const settingsRepository = new ProviderSettingsRepository(base.root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
  const budget = new OpenAiBudget(base.root, 10);
  const service = new LocalImageGenerationService(base.projects, base.mappings, base.projectsRoot, undefined, new LocalAssetsRepository(path.dirname(base.projectsRoot)), providerSettings, budget);
  return { ...base, providerSettings, budget, service };
}

const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

async function setupWithConnectedOpenAiAndConfirmedReference() {
  const base = await setupWithConnectedOpenAi();
  const assets = new LocalAssetsRepository(path.dirname(base.projectsRoot));
  const character = await assets.create({ buffer: PNG_BYTES, originalname: "hero.png", mimetype: "image/png" }, { assetType: "character", displayName: "Hero", approved: true });
  const now = "2026-08-22T00:00:00.000Z";
  await base.mappings.save("images", [{
    mapping_id: "MAP-TEST0001", project_id: "images", asset_id: character.asset_id, enabled: true, usage_role: "character",
    scene_scope: { mode: "all" }, assignment_source: "manual", confidence: null, match_reason: "manual_assignment",
    status: "confirmed", user_confirmed: true, version_policy: "follow_latest", pinned_version: null, candidate_only: false,
    created_at: now, updated_at: now, snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [],
  }]);
  await base.mappings.saveReview("images", { project_id: "images", mapping_revision: 1, script_revision: 1, script_fingerprint: scriptFingerprint((await base.projects.findById("images")).scenes), status: "approved", approved_at: now, approved_by: "user", text_only_confirmed: false, legacy_confirmed: false, reviewed_scenes: [1, 2, 3, 4, 5, 6] });
  return { ...base, character };
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
    expect(reloaded.image_prompts).toEqual([1, 2, 3, 4, 5, 6].map((number) =>
      `Scene: action ${number}\nShot: medium shot, eye level\nComposition: composition ${number}\nLens: natural\nFocus: subject`));
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

  it("assembles the image prompt from visual_action and composition fields, never the narrated description, and omits empty composition lines", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    const project = await projects.findById("images");
    project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({
      number, description: `A character says "line ${number}" while walking.`, main_motion: `motion ${number}`,
      visual_action: `walks toward the ${number} gate`, shot_size: "", camera_angle: "", composition: "", lens_feel: "", focus_subject: "",
    }));
    await projects.save(project);
    await mappings.saveReview("images", { ...(await mappings.loadReview("images")), script_fingerprint: scriptFingerprint(project.scenes) });
    await new LocalImageGenerationService(projects, mappings, projectsRoot).generate("images", { approved: true });
    const reloaded = await new LocalProjectRepository(projectsRoot).findById("images");
    for (const [index, prompt] of reloaded.image_prompts.entries()) {
      expect(prompt).toBe(`Scene: walks toward the ${index + 1} gate`);
      expect(prompt).not.toContain("says");
      expect(prompt).not.toContain("Shot:");
    }
  });

  it("appends a deterministic Style line from project style settings, preferring styleNotes over style_profile and always excluding camera", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    const project = await projects.findById("images");
    project.style_profile = { visual_style: "watercolor", color: "pastel", lighting: "soft", camera: "handheld" };
    project.lore_context = { style_notes: { visual_style: "override style" } };
    await projects.save(project);
    await new LocalImageGenerationService(projects, mappings, projectsRoot).generate("images", { approved: true });
    const reloaded = await new LocalProjectRepository(projectsRoot).findById("images");
    for (const prompt of reloaded.image_prompts) {
      expect(prompt).toContain("Style: override style, pastel, soft");
      expect(prompt).not.toContain("handheld");
    }
  });

  it("omits the Style line entirely when no project style setting is present", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    await new LocalImageGenerationService(projects, mappings, projectsRoot).generate("images", { approved: true });
    const reloaded = await new LocalProjectRepository(projectsRoot).findById("images");
    for (const prompt of reloaded.image_prompts) expect(prompt).not.toContain("Style:");
  });

  it("rejects generation when a scene is missing visual_action, the field the image prompt now depends on", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    const project = await projects.findById("images");
    project.scenes[0] = { number: 1, description: "scene 1", main_motion: "motion 1" };
    await projects.save(project);
    await expect(new LocalImageGenerationService(projects, mappings, projectsRoot).generate("images", { approved: true }))
      .rejects.toMatchObject({ response: { code: "IMAGE_GENERATION_FAILED" } });
  });

  it("serves a generated scene's PNG bytes by canonical path and rejects an out-of-range or ungenerated scene", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    const service = new LocalImageGenerationService(projects, mappings, projectsRoot);
    await service.generate("images", { approved: true });
    const content = await service.content("images", "3");
    expect(content).toEqual({ path: path.join(projectsRoot, "images", "images", "scene3.png"), extension: ".png" });
    await expect(fs.readFile(content.path)).resolves.toEqual(await fs.readFile(path.join(projectsRoot, "images", "images", "scene3.png")));
    await expect(service.content("images", "7")).rejects.toMatchObject({ response: { code: "IMAGE_CONTENT_UNAVAILABLE" } });
    await expect(service.content("images", "abc")).rejects.toMatchObject({ response: { code: "IMAGE_CONTENT_UNAVAILABLE" } });
    const { projectsRoot: freshRoot, projects: freshProjects, mappings: freshMappings } = await setup();
    await expect(new LocalImageGenerationService(freshProjects, freshMappings, freshRoot).content("images", "1")).rejects.toMatchObject({ response: { code: "IMAGE_CONTENT_UNAVAILABLE" } });
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

describe("real OpenAI image generation", () => {
  it("calls the real adapter for all six scenes and records the real model as the adapter", async () => {
    const { projectsRoot, service } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.generate("images", { approved: true });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(result.project.workflowState).toBe(WorkflowState.ImagesReview);
    const reloaded = await new LocalProjectRepository(projectsRoot).findById("images");
    expect(reloaded.image_generation_records).toEqual(expect.arrayContaining([expect.objectContaining({ scene_number: 1, adapter: "gpt-image-2", image_api_calls: 1 })]));
  });

  it("falls back to the local fake adapter, never calling fetch, when no OpenAI credential is configured", async () => {
    const { projectsRoot, projects, mappings } = await setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await new LocalImageGenerationService(projects, mappings, projectsRoot).generate("images", { approved: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await new LocalProjectRepository(projectsRoot).findById("images")).image_generation_records).toEqual(
      expect.arrayContaining([expect.objectContaining({ adapter: "local-fake-image-adapter", image_api_calls: 0 })]),
    );
  });

  it("blocks the real request and restores ASSET_MAPPING_APPROVED when the monthly budget is already spent", async () => {
    const { projects, budget, service } = await setupWithConnectedOpenAi();
    await budget.record("images", "image", true, 10, new Date());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(service.generate("images", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_BUDGET_EXCEEDED" } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await projects.findById("images")).workflow_state).toBe(WorkflowState.AssetMappingApproved);
  });

  it("classifies a real provider failure, records failed budget usage, and restores ASSET_MAPPING_APPROVED for retry", async () => {
    const { root, projects, service } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(service.generate("images", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_PROVIDER_ERROR", details: { category: "authentication" } } });

    expect((await projects.findById("images")).workflow_state).toBe(WorkflowState.AssetMappingApproved);
    const usage = JSON.parse(await fs.readFile(path.join(root, "api_budget_usage.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(usage).toEqual([expect.objectContaining({ project_id: "images", api_type: "image", succeeded: false })]);
  });

  it("sends the confirmed Asset Mapping's approved Reference image via images/edits for every scene, recording the :edit adapter", async () => {
    const { projectsRoot, service } = await setupWithConnectedOpenAiAndConfirmedReference();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await service.generate("images", { approved: true });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const call of fetchMock.mock.calls) {
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe("https://api.openai.com/v1/images/edits");
      expect((init.body as FormData).getAll("image[]")).toHaveLength(1);
    }
    const reloaded = await new LocalProjectRepository(projectsRoot).findById("images");
    expect(reloaded.image_generation_records).toEqual(expect.arrayContaining([expect.objectContaining({ scene_number: 1, adapter: "gpt-image-2:edit", image_api_calls: 1 })]));
  });

  it("includes the linked previous project's approved Scene 6 as an additional Scene 1 Reference only", async () => {
    const { projectsRoot, projects, service } = await setupWithConnectedOpenAiAndConfirmedReference();
    const continuityImage = path.join(projectsRoot, "continuity_source_scene6.png");
    await fs.writeFile(continuityImage, PNG_BYTES);
    const project = await projects.findById("images");
    project.lore_context = { ...project.lore_context, previous_scene_link: { source_kind: "short_project", user_selected: true, project_id: "other", project_name: "Other", label: "Other · Scene 6", scene_number: 6, story_context: "context", image_path: continuityImage } };
    await projects.save(project);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await service.generate("images", { approved: true });

    const editCalls = fetchMock.mock.calls.filter((call) => call[0] === "https://api.openai.com/v1/images/edits");
    expect(editCalls).toHaveLength(6);
    const sceneOneReferenceCount = (editCalls[0]![1] as RequestInit).body as FormData;
    expect(sceneOneReferenceCount.getAll("image[]")).toHaveLength(2); // confirmed character mapping + continuity Scene 6
    for (const call of editCalls.slice(1)) {
      expect(((call[1] as RequestInit).body as FormData).getAll("image[]")).toHaveLength(1); // no continuity image outside Scene 1
    }
  });

  it("falls back to reference-free images/generations when no Asset Mapping is confirmed", async () => {
    const { service } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await service.generate("images", { approved: true });

    for (const call of fetchMock.mock.calls) expect(call[0]).toBe("https://api.openai.com/v1/images/generations");
  });
});
