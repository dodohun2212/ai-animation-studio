import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository, scriptFingerprint } from "../mappings/mappings.repository.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { ImageReviewService } from "./image-review.service.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "image-review-")); roots.push(root);
  const projectsRoot = path.join(root, "learning_data", "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("review", "image review", "2026-08-22T00:00:00.000Z");
  project.workflow_state = WorkflowState.ImagesReview;
  await projects.create(project);
  const images = path.join(projectsRoot, "review", "images");
  await fs.mkdir(images, { recursive: true });
  project.generated_images = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => {
    const file = path.join(images, `scene${number}.png`); await fs.writeFile(file, PNG); return file;
  }));
  await projects.save(project);
  project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `A character says "line ${number}".`, visual_action: `walks toward the ${number} gate` }));
  await projects.save(project);
  const assets = new LocalAssetsRepository(path.dirname(projectsRoot));
  await assets.indexGeneratedProjectImages("review", project.topic, [1, 2, 3, 4, 5, 6].map((number) => `scene ${number}`));
  return { root, projectsRoot, projects, assets, service: new ImageReviewService(projects, projectsRoot, assets) };
}

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=";
function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

async function setupWithConnectedOpenAiAndConfirmedReference() {
  const base = await setup();
  const settingsRepository = new ProviderSettingsRepository(base.root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
  const budget = new OpenAiBudget(base.root, 10);
  const character = await base.assets.create({ buffer: PNG, originalname: "hero.png", mimetype: "image/png" }, { assetType: "character", displayName: "Hero", approved: true });
  const mappings = new LocalProjectAssetMappingsRepository(base.projectsRoot);
  const now = "2026-08-22T00:00:00.000Z";
  await mappings.save("review", [{
    mapping_id: "MAP-TEST0001", project_id: "review", asset_id: character.asset_id, enabled: true, usage_role: "character",
    scene_scope: { mode: "all" }, assignment_source: "manual", confidence: null, match_reason: "manual_assignment",
    status: "confirmed", user_confirmed: true, version_policy: "follow_latest", pinned_version: null, candidate_only: false,
    created_at: now, updated_at: now, snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [],
  }]);
  await mappings.saveReview("review", { project_id: "review", mapping_revision: 1, script_revision: 0, script_fingerprint: scriptFingerprint((await base.projects.findById("review")).scenes), status: "approved", approved_at: now, approved_by: "user", text_only_confirmed: false, legacy_confirmed: false, reviewed_scenes: [1, 2, 3, 4, 5, 6] });
  const service = new ImageReviewService(base.projects, base.projectsRoot, base.assets, mappings, providerSettings, budget);
  return { ...base, providerSettings, budget, service };
}

describe("provider-free generated image review", () => {
  it("returns six pending review rows for valid generated images without writing review metadata", async () => {
    const { projectsRoot, service } = await setup();
    const result = await service.getStatus("review");
    expect(result.project.workflowState).toBe(WorkflowState.ImagesReview);
    expect(result.reviews).toEqual(expect.arrayContaining([{ sceneNumber: 1, status: "pending", updatedAt: expect.any(String) }]));
    await expect(fs.stat(path.join(projectsRoot, "review", "generated_image_reviews.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.budget).toBeUndefined(); // no OpenAI credential/budget wired in — local fake mode
    expect(result.staleness).toEqual({ imageStale: [], videoStale: [], narrationStale: [] }); // freshly generated, nothing edited since
  });

  it("flags a scene's image as stale after its composition fields are edited without regenerating", async () => {
    const { projects, service } = await setup();
    const project = await projects.findById("review");
    const { imagePromptFor, styleLineFor } = await import("./image-prompt.js");
    project.image_generation_records = [{ scene_number: 1, prompt: imagePromptFor(project.scenes[0], styleLineFor(project)) }];
    project.scenes[0] = { ...(project.scenes[0] as Record<string, unknown>), focus_subject: "edited after generation" };
    await projects.save(project);
    const result = await service.getStatus("review");
    expect(result.staleness?.imageStale).toEqual([1]);
  });

  it("does not flag imageStale for a project with a confirmed Asset Mapping, when nothing has actually changed", async () => {
    // Before this, computeSceneStaleness always recomputed imagePromptFor() without a References block, so
    // any project with a confirmed mapping (like this fixture's character) permanently mismatched the real
    // recorded prompt (which does have one) and every scene showed imageStale forever.
    const { projects, projectsRoot, assets, service } = await setupWithConnectedOpenAiAndConfirmedReference();
    const project = await projects.findById("review");
    const { imagePromptFor, styleLineFor } = await import("./image-prompt.js");
    const { describeReferenceMappingsForScene } = await import("./image-reference-selection.js");
    const mappingsRepo = new LocalProjectAssetMappingsRepository(projectsRoot);
    const mappings = await mappingsRepo.load("review");
    const styleLine = styleLineFor(project);
    project.image_generation_records = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => ({
      scene_number: number,
      prompt: imagePromptFor(project.scenes[number - 1], styleLine, await describeReferenceMappingsForScene(assets, mappings, number as never)),
    })));
    await projects.save(project);

    const result = await service.getStatus("review");

    expect(result.staleness?.imageStale).toEqual([]);
  });

  it("flags imageStale once the mapped Asset's own description changes, even though no scene field was touched", async () => {
    const { projects, projectsRoot, assets, service } = await setupWithConnectedOpenAiAndConfirmedReference();
    const project = await projects.findById("review");
    const { imagePromptFor, styleLineFor } = await import("./image-prompt.js");
    const { describeReferenceMappingsForScene } = await import("./image-reference-selection.js");
    const mappingsRepo = new LocalProjectAssetMappingsRepository(projectsRoot);
    const mappings = await mappingsRepo.load("review");
    const styleLine = styleLineFor(project);
    // Record the prompt as it was BEFORE the character's description was ever written — no mismatch yet.
    project.image_generation_records = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => ({
      scene_number: number,
      prompt: imagePromptFor(project.scenes[number - 1], styleLine, await describeReferenceMappingsForScene(assets, mappings, number as never)),
    })));
    await projects.save(project);
    // Now the character gains a description — the same recomputation must diverge from the recorded prompt.
    await assets.update(mappings[0]!.asset_id, { description: "은발 단발, 왼쪽 눈 흉터" });

    const result = await service.getStatus("review");

    expect(result.staleness?.imageStale).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reports the real budget ledger state when an OpenAI credential is connected", async () => {
    const { budget, service } = await setupWithConnectedOpenAiAndConfirmedReference();
    await budget.record("review", "image", true, 4, new Date());
    const result = await service.getStatus("review");
    expect(result.budget).toEqual({ monthlyLimitUsd: 10, spentUsd: 4, remainingUsd: 6, estimatedRequestCostUsd: 0.10, canSpend: true });
  });

  it("requires an explicit action, a numeric scene 1 through 6, IMAGES_REVIEW, and a valid PNG", async () => {
    const { projectsRoot, projects, service } = await setup();
    await expect(service.approve("review", "1", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.approve("review", "0", { approved: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const project = await projects.findById("review"); project.workflow_state = WorkflowState.ImagesReady; await projects.save(project);
    await expect(service.approve("review", "1", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_NOT_ALLOWED" } });
    project.workflow_state = WorkflowState.ImagesReview; await projects.save(project);
    await fs.rm(path.join(projectsRoot, "review", "images", "scene1.png"));
    await expect(service.approve("review", "1", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_IMAGE_INVALID" } });
  });

  it("persists per-scene approval history, survives a new service instance, and advances only after all six", async () => {
    const { projectsRoot, projects, assets, service } = await setup();
    const first = await service.approve("review", "1", { approved: true });
    expect(first.project.workflowState).toBe(WorkflowState.ImagesReview);
    expect(first.reviews.find((review) => review.sceneNumber === 1)?.status).toBe("approved");
    const raw = JSON.parse(await fs.readFile(path.join(projectsRoot, "review", "generated_image_reviews.json"), "utf8"));
    expect(raw).toEqual([expect.objectContaining({ scene_number: 1, status: "approved", history: [expect.objectContaining({ event: "approved" })] })]);
    const restarted = new ImageReviewService(new LocalProjectRepository(projectsRoot), projectsRoot);
    for (const scene of [2, 3, 4, 5, 6]) await restarted.approve("review", String(scene), { approved: true });
    const reloaded = await new LocalProjectRepository(projectsRoot).findById("review");
    expect(reloaded.workflow_state).toBe(WorkflowState.WaitingForVideoConfirmation);
    // Read-only, so it must stay viewable once every scene is approved and the project has moved on to video
    // confirmation — the Frontend's video confirmation screen relies on this GET succeeding.
    const status = await restarted.getStatus("review");
    expect(status.reviews.every((review) => review.status === "approved")).toBe(true);
    expect((await projects.findById("review")).workflow_state).toBe(WorkflowState.WaitingForVideoConfirmation);
  });

  it("rejects damaged review JSON without treating it as a pending decision", async () => {
    const { projectsRoot, service } = await setup();
    await fs.writeFile(path.join(projectsRoot, "review", "generated_image_reviews.json"), "{bad", "utf8");
    await expect(service.getStatus("review")).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_DATA_INVALID" } });
  });

  it("archives only the regenerated scene, resets its approval, and survives a new service instance", async () => {
    const { projectsRoot, projects, assets, service } = await setup();
    for (const scene of [1, 2, 3, 4, 5, 6]) await service.approve("review", String(scene), { approved: true });
    const before = await fs.readFile(path.join(projectsRoot, "review", "images", "scene3.png"));
    const result = await service.regenerate("review", "3", { approved: true });
    expect(result.project.workflowState).toBe(WorkflowState.ImagesReview);
    expect(result.reviews.find((review) => review.sceneNumber === 3)?.status).toBe("pending");
    expect(result.reviews.filter((review) => review.sceneNumber !== 3).every((review) => review.status === "approved")).toBe(true);
    const archive = path.join(projectsRoot, "review", "images", "originals", "scene3_v001.png");
    await expect(fs.readFile(archive)).resolves.toEqual(before);
    const raw = JSON.parse(await fs.readFile(path.join(projectsRoot, "review", "generated_image_reviews.json"), "utf8"));
    expect(raw.find((item: { scene_number: number }) => item.scene_number === 3)).toEqual(expect.objectContaining({
      status: "pending", regeneration_count: 1,
      history: expect.arrayContaining([expect.objectContaining({ event: "pending" }), expect.objectContaining({ event: "regenerated" })]),
    }));
    const restarted = new ImageReviewService(new LocalProjectRepository(projectsRoot), projectsRoot);
    await restarted.approve("review", "3", { approved: true });
    expect((await projects.findById("review")).workflow_state).toBe(WorkflowState.WaitingForVideoConfirmation);
  });

  it("rejects unknown or unsafe regeneration input and never reads or archives a stored path outside the project images folder", async () => {
    const { projectsRoot, projects, service } = await setup();
    await expect(service.regenerate("review", "01", { approved: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.regenerate("review", "1", { approved: true, extra: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const project = await projects.findById("review");
    const outside = path.join(path.dirname(project.generated_images[0]!), "..", "outside.png");
    await fs.writeFile(outside, "not a scene image");
    project.generated_images[0] = outside;
    await projects.save(project);
    const before = await fs.readFile(path.join(projectsRoot, "review", "images", "scene1.png"));
    const result = await service.regenerate("review", "1", { approved: true });
    expect(result.reviews.find((review) => review.sceneNumber === 1)?.status).toBe("pending");
    // The tampered metadata pointed elsewhere, but only the canonical scene1.png was ever
    // touched: "outside.png" is untouched and the real image was archived, not read from there.
    await expect(fs.readFile(outside, "utf8")).resolves.toBe("not a scene image");
    await expect(fs.readFile(path.join(projectsRoot, "review", "images", "originals", "scene1_v001.png"))).resolves.toEqual(before);
  });

  it("still reviews a project whose stored image paths were written by a different machine or moved folder", async () => {
    const { projects, projectsRoot, service } = await setup();
    const project = await projects.findById("review");
    project.generated_images = [1, 2, 3, 4, 5, 6].map((number) =>
      path.join("C:", "Users", "other-machine", "OneDrive", "AI-Animation-Studio", "learning_data", "projects", "review", "images", `scene${number}.png`));
    await projects.save(project);
    const result = await service.getStatus("review");
    expect(result.project.workflowState).toBe(WorkflowState.ImagesReview);
    // The real files on this machine, at the canonical path, are untouched and still readable.
    await expect(fs.readFile(path.join(projectsRoot, "review", "images", "scene1.png"))).resolves.toEqual(PNG);
  });

  it("does not replace image bytes when existing review metadata is malformed", async () => {
    const { projectsRoot, service } = await setup();
    const current = path.join(projectsRoot, "review", "images", "scene1.png");
    const before = await fs.readFile(current);
    await fs.writeFile(path.join(projectsRoot, "review", "generated_image_reviews.json"), "{bad", "utf8");
    await expect(service.regenerate("review", "1", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_DATA_INVALID" } });
    await expect(fs.readFile(current)).resolves.toEqual(before);
    await expect(fs.stat(path.join(projectsRoot, "review", "images", "originals"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("real OpenAI image regeneration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("regenerates via images/edits using the confirmed Asset Mapping's Reference image and records the :edit adapter", async () => {
    const { projectsRoot, service } = await setupWithConnectedOpenAiAndConfirmedReference();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.regenerate("review", "3", { approved: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect((init.body as FormData).getAll("image[]")).toHaveLength(1);
    // Sends the composition-assembled prompt (Round 28), never the narrated description with its dialogue —
    // plus a text description of the same confirmed mapping whose image bytes are attached above.
    const prompt = (init.body as FormData).get("prompt");
    expect(prompt).toBe("Scene: walks toward the 3 gate\nReferences:\n- review Scene 1 (character)\n  설명: scene 1");
    expect(prompt).not.toContain("says");
    const raw = JSON.parse(await fs.readFile(path.join(projectsRoot, "review", "generated_image_reviews.json"), "utf8")) as Array<{ scene_number: number }>;
    expect(raw.find((item) => item.scene_number === 3)).toBeTruthy();
    const project = JSON.parse(await fs.readFile(path.join(projectsRoot, "review", "project.json"), "utf8")) as { image_generation_records: Array<{ scene_number: number; adapter: string; image_api_calls: number }> };
    expect(project.image_generation_records[2]).toMatchObject({ scene_number: 3, adapter: "gpt-image-2:edit", image_api_calls: 1 });
    expect(result.retryEstimate).toEqual({
      perSceneCostUsd: 0.10,
      budget: { monthlyLimitUsd: 10, spentUsd: 0.10, remainingUsd: 9.90, estimatedRequestCostUsd: 0.10, canSpend: true },
    });
  });

  it("reports how many Reference images were left out once the 16-image cap is hit, and getStatus reflects the same count afterward", async () => {
    const base = await setupWithConnectedOpenAiAndConfirmedReference();
    const mappings = new LocalProjectAssetMappingsRepository(base.projectsRoot);
    const now = "2026-08-22T00:00:00.000Z";
    const extra = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      base.assets.create({ buffer: PNG, originalname: `extra${index}.png`, mimetype: "image/png" }, { assetType: "style", displayName: `Extra ${index}` })));
    await mappings.save("review", [
      ...(await mappings.load("review")),
      ...extra.map((asset, index) => ({
        mapping_id: `MAP-EXTRA${String(index).padStart(4, "0")}`, project_id: "review", asset_id: asset.asset_id, enabled: true, usage_role: "style",
        scene_scope: { mode: "all" as const }, assignment_source: "manual" as const, confidence: null, match_reason: "manual_assignment",
        status: "confirmed" as const, user_confirmed: true, version_policy: "follow_latest" as const, pinned_version: null, candidate_only: false,
        created_at: now, updated_at: now, snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [],
      })),
    ]);
    // 1 (setup's own confirmed character) + 16 extra = 17 eligible, 1 over the 16-image cap.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await base.service.regenerate("review", "3", { approved: true });

    expect((result.reviews.find((review) => review.sceneNumber === 3))).toMatchObject({ referencesUsedCount: 16, referencesOmittedCount: 1 });
    // Every other scene never hit the cap and must stay quiet.
    for (const review of result.reviews.filter((item) => item.sceneNumber !== 3)) {
      expect(review.referencesUsedCount).toBeUndefined();
      expect(review.referencesOmittedCount).toBeUndefined();
    }
    const status = await base.service.getStatus("review");
    expect(status.reviews.find((review) => review.sceneNumber === 3)).toMatchObject({ referencesUsedCount: 16, referencesOmittedCount: 1 });
  });

  it("appends additionalInstruction as the prompt's last line without persisting it, so staleness stays unaffected", async () => {
    const { projectsRoot, service } = await setupWithConnectedOpenAiAndConfirmedReference();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await service.regenerate("review", "3", { approved: true, additionalInstruction: "  더 어둡게  " });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = (init.body as FormData).get("prompt");
    expect(prompt).toBe("Scene: walks toward the 3 gate\nReferences:\n- review Scene 1 (character)\n  설명: scene 1\n더 어둡게");
    // The persisted record keeps the plain scene prompt (not the one-off instruction), so a later
    // staleness check still compares like-for-like against a freshly recomputed plain prompt.
    const project = JSON.parse(await fs.readFile(path.join(projectsRoot, "review", "project.json"), "utf8")) as { image_generation_records: Array<{ prompt: string }> };
    expect(project.image_generation_records[2]!.prompt).not.toContain("더 어둡게");
  });

  it("ignores a blank additionalInstruction the same as omitting it", async () => {
    const { service } = await setupWithConnectedOpenAiAndConfirmedReference();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await service.regenerate("review", "3", { approved: true, additionalInstruction: "   " });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get("prompt")).toBe("Scene: walks toward the 3 gate\nReferences:\n- review Scene 1 (character)\n  설명: scene 1");
  });

  it("rejects a non-string additionalInstruction", async () => {
    const { service } = await setup();
    await expect(service.regenerate("review", "2", { approved: true, additionalInstruction: 5 })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("omits retryEstimate when no OpenAI credential is configured (local fake adapter)", async () => {
    const { service } = await setup();
    const result = await service.regenerate("review", "2", { approved: true });
    expect(result.retryEstimate).toBeUndefined();
  });

  it("never calls fetch and keeps the local fake adapter when no OpenAI credential is configured", async () => {
    const { service } = await setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await service.regenerate("review", "2", { approved: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks the real request and leaves the current image untouched when the monthly budget is already spent", async () => {
    const { projectsRoot, budget, service } = await setupWithConnectedOpenAiAndConfirmedReference();
    await budget.record("review", "image", true, 10, new Date());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const current = path.join(projectsRoot, "review", "images", "scene3.png");
    const before = await fs.readFile(current);

    await expect(service.regenerate("review", "3", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_BUDGET_EXCEEDED" } });

    expect(fetchMock).not.toHaveBeenCalled();
    await expect(fs.readFile(current)).resolves.toEqual(before);
  });

  it("classifies a real provider failure, records failed budget usage, and leaves the current image untouched", async () => {
    const { root, projectsRoot, service } = await setupWithConnectedOpenAiAndConfirmedReference();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key" } }));
    vi.stubGlobal("fetch", fetchMock);
    const current = path.join(projectsRoot, "review", "images", "scene3.png");
    const before = await fs.readFile(current);

    await expect(service.regenerate("review", "3", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_PROVIDER_ERROR", details: { category: "authentication" } } });

    await expect(fs.readFile(current)).resolves.toEqual(before);
    const usage = JSON.parse(await fs.readFile(path.join(root, "api_budget_usage.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(usage).toEqual([expect.objectContaining({ project_id: "review", api_type: "image", succeeded: false })]);
  });
});
