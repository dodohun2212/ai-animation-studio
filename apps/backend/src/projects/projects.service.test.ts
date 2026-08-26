import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";

const CHAR_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const SECOND_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

describe("ProjectsService", () => {
  let root: string;
  let service: ProjectsService;

  beforeEach(async () => {
    root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "projects-service-test-"));
    service = new ProjectsService(new LocalProjectRepository(root));
  });

  afterEach(async () => {
    await fsPromises.rm(root, { recursive: true, force: true });
  });

  it("creates a project and returns the camelCase API shape", async () => {
    const response = await service.createProject({ projectId: "sample_project", topic: "우주를 여행하는 고양이" });

    expect(response.project).toEqual({
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      workflowState: WorkflowState.Ready,
      createdAt: response.project.createdAt,
      updatedAt: response.project.updatedAt,
      aspectRatio: "9:16",
      scenes: [],
      warnings: [],
      errors: [],
    });
    expect(new Date(response.project.createdAt).toISOString()).toBe(response.project.createdAt);
  });

  it("trims surrounding whitespace on projectId and topic", async () => {
    const response = await service.createProject({ projectId: "  padded_id  ", topic: "  padded topic  " });
    expect(response.project.id).toBe("padded_id");
    expect(response.project.topic).toBe("padded topic");
  });

  it("rejects an empty or missing projectId/topic", async () => {
    await expect(service.createProject({ projectId: "", topic: "topic" })).rejects.toThrow();
    await expect(service.createProject({ projectId: "id", topic: "   " })).rejects.toThrow();
    await expect(
      service.createProject({} as unknown as { projectId: string; topic: string }),
    ).rejects.toThrow();
  });

  it("rejects an unsafe projectId", async () => {
    await expect(service.createProject({ projectId: "../escape", topic: "topic" })).rejects.toThrow();
  });

  it("rejects a duplicate projectId", async () => {
    await service.createProject({ projectId: "dup_project", topic: "first" });
    await expect(service.createProject({ projectId: "dup_project", topic: "second" })).rejects.toThrow();
  });

  it("returns an empty list when no projects exist", async () => {
    expect(await service.listProjects()).toEqual({ projects: [] });
  });

  it("lists multiple projects sorted by most recently updated first", async () => {
    await service.createProject({ projectId: "older", topic: "older topic" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.createProject({ projectId: "newer", topic: "newer topic" });

    const { projects } = await service.listProjects();
    expect(projects.map((project) => project.id)).toEqual(["newer", "older"]);
  });

  it("reopens a created project by ID with matching fields", async () => {
    const created = await service.createProject({ projectId: "reopen_me", topic: "topic" });
    const reopened = await service.getProject("reopen_me");
    expect(reopened.project).toEqual(created.project);
  });

  it("throws a not-found error for a missing project", async () => {
    await expect(service.getProject("missing_project")).rejects.toThrow();
  });

  it("saves Wizard settings and reopens them from a new backend instance", async () => {
    await service.createProject({ projectId: "wizard_project", topic: "old topic" });
    const settings = {
      projectName: "별의 지도", topic: "별을 찾는 아이", genre: "판타지", mood: "따뜻함",
      character: "아이", lore: "별의 세계", fullStory: "별을 찾는다.",
      sceneCount: 6 as const, clipDurationSeconds: 5 as const, additionalNotes: "무서운 장면 제외",
      styleNotes: { lighting: "달빛", aspect: "16:9" }, narrationEnabled: false, subtitlesEnabled: false,
    };

    const saved = await service.updateProjectSettings("wizard_project", { settings });
    const restarted = new ProjectsService(new LocalProjectRepository(root));

    expect(saved.project.topic).toBe("별을 찾는 아이");
    // durationSeconds is derived server-side (sceneCount * clipDurationSeconds), not part of the request.
    expect(await restarted.getProjectSettings("wizard_project")).toEqual({ settings: { ...settings, durationSeconds: 30 } });
  });

  it("returns an empty cast for a project that has never set one", async () => {
    await service.createProject({ projectId: "cast_project", topic: "topic" });
    expect(await service.getProjectCast("cast_project")).toEqual({ cast: [] });
  });

  it("saves a Wizard cast selection, validates each Asset, and reopens it from a new backend instance", async () => {
    const assets = new LocalAssetsRepository(root);
    const withAssets = new ProjectsService(new LocalProjectRepository(root), assets);
    await withAssets.createProject({ projectId: "cast_project", topic: "topic" });
    const hero = await assets.create({ buffer: CHAR_PNG, originalname: "hero.png" }, { assetType: "character", displayName: "Hero" });

    const saved = await withAssets.updateProjectCast("cast_project", { cast: [{ assetId: hero.asset_id, castRole: "protagonist", storyRole: "대표 캐릭터" }] });
    expect(saved).toEqual({ cast: [{ assetId: hero.asset_id, castRole: "protagonist", storyRole: "대표 캐릭터" }] });

    const restarted = new ProjectsService(new LocalProjectRepository(root), new LocalAssetsRepository(root));
    expect(await restarted.getProjectCast("cast_project")).toEqual(saved);
  });

  it("rejects a cast selection referencing an Asset that does not exist", async () => {
    const withAssets = new ProjectsService(new LocalProjectRepository(root), new LocalAssetsRepository(root));
    await withAssets.createProject({ projectId: "cast_project", topic: "topic" });
    await expect(withAssets.updateProjectCast("cast_project", { cast: [{ assetId: "ASSET-CHAR-MISSING", castRole: "protagonist", storyRole: "대표 캐릭터" }] }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("accepts a Folder character Asset as a cast member — the cast search screen only ever offers Folders", async () => {
    const assets = new LocalAssetsRepository(root);
    const withAssets = new ProjectsService(new LocalProjectRepository(root), assets);
    await withAssets.createProject({ projectId: "cast_project", topic: "topic" });
    const folder = await assets.createFolder({ assetType: "character", displayName: "Hero folder" });

    const saved = await withAssets.updateProjectCast("cast_project", { cast: [{ assetId: folder.asset_id, castRole: "protagonist", storyRole: "대표 캐릭터" }] });
    expect(saved).toEqual({ cast: [{ assetId: folder.asset_id, castRole: "protagonist", storyRole: "대표 캐릭터" }] });
  });

  it("rejects a cast selection referencing a non-character Asset", async () => {
    const assets = new LocalAssetsRepository(root);
    const withAssets = new ProjectsService(new LocalProjectRepository(root), assets);
    await withAssets.createProject({ projectId: "cast_project", topic: "topic" });
    const background = await assets.create({ buffer: CHAR_PNG, originalname: "bg.png" }, { assetType: "background", displayName: "Background" });

    await expect(withAssets.updateProjectCast("cast_project", { cast: [{ assetId: background.asset_id, castRole: "protagonist", storyRole: "대표 캐릭터" }] }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("skips Asset validation when no assets repository is injected", async () => {
    await service.createProject({ projectId: "cast_project", topic: "topic" });
    const saved = await service.updateProjectCast("cast_project", { cast: [{ assetId: "ASSET-CHAR-ANY", castRole: "protagonist", storyRole: "대표 캐릭터" }] });
    expect(saved.cast).toHaveLength(1);
  });

  it("returns empty asset references for a project that has never set any", async () => {
    await service.createProject({ projectId: "refs_project", topic: "topic" });
    expect(await service.getProjectAssetReferences("refs_project")).toEqual({ atmosphereAssetIds: [], sceneReferenceAssets: [] });
  });

  it("saves atmosphere and scene reference Asset selections, validates each Asset's type, and reopens them from a new backend instance", async () => {
    const assets = new LocalAssetsRepository(root);
    const withAssets = new ProjectsService(new LocalProjectRepository(root), assets);
    await withAssets.createProject({ projectId: "refs_project", topic: "topic" });
    const style = await assets.create({ buffer: CHAR_PNG, originalname: "style.png" }, { assetType: "style", displayName: "Style" });
    const object = await assets.create({ buffer: SECOND_PNG, originalname: "key.png" }, { assetType: "object", displayName: "Key" });

    const saved = await withAssets.updateProjectAssetReferences("refs_project", {
      atmosphereAssetIds: [style.asset_id],
      sceneReferenceAssets: [{ assetId: object.asset_id, purpose: "주인공이 항상 들고 다니는 열쇠" }],
    });
    expect(saved).toEqual({ atmosphereAssetIds: [style.asset_id], sceneReferenceAssets: [{ assetId: object.asset_id, purpose: "주인공이 항상 들고 다니는 열쇠" }] });

    const restarted = new ProjectsService(new LocalProjectRepository(root), new LocalAssetsRepository(root));
    expect(await restarted.getProjectAssetReferences("refs_project")).toEqual(saved);
  });

  it("rejects an atmosphere Asset selection referencing an Asset that does not exist", async () => {
    const withAssets = new ProjectsService(new LocalProjectRepository(root), new LocalAssetsRepository(root));
    await withAssets.createProject({ projectId: "refs_project", topic: "topic" });
    await expect(withAssets.updateProjectAssetReferences("refs_project", { atmosphereAssetIds: ["ASSET-MISSING"], sceneReferenceAssets: [] }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects an atmosphere Asset selection referencing a character Asset", async () => {
    const assets = new LocalAssetsRepository(root);
    const withAssets = new ProjectsService(new LocalProjectRepository(root), assets);
    await withAssets.createProject({ projectId: "refs_project", topic: "topic" });
    const hero = await assets.create({ buffer: CHAR_PNG, originalname: "hero.png" }, { assetType: "character", displayName: "Hero" });
    await expect(withAssets.updateProjectAssetReferences("refs_project", { atmosphereAssetIds: [hero.asset_id], sceneReferenceAssets: [] }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects a scene reference Asset selection referencing a character Asset", async () => {
    const assets = new LocalAssetsRepository(root);
    const withAssets = new ProjectsService(new LocalProjectRepository(root), assets);
    await withAssets.createProject({ projectId: "refs_project", topic: "topic" });
    const hero = await assets.create({ buffer: CHAR_PNG, originalname: "hero.png" }, { assetType: "character", displayName: "Hero" });
    await expect(withAssets.updateProjectAssetReferences("refs_project", { atmosphereAssetIds: [], sceneReferenceAssets: [{ assetId: hero.asset_id, purpose: "x" }] }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("skips Asset validation for asset references when no assets repository is injected", async () => {
    await service.createProject({ projectId: "refs_project", topic: "topic" });
    const saved = await service.updateProjectAssetReferences("refs_project", { atmosphereAssetIds: ["ASSET-ANY"], sceneReferenceAssets: [] });
    expect(saved.atmosphereAssetIds).toEqual(["ASSET-ANY"]);
  });

  it("auto-links a cast member as a confirmed Asset Mapping, and removes it again once the cast member is removed", async () => {
    const assets = new LocalAssetsRepository(root);
    const mappings = new LocalProjectAssetMappingsRepository(root);
    const withMappings = new ProjectsService(new LocalProjectRepository(root), assets, mappings);
    await withMappings.createProject({ projectId: "cast_project", topic: "topic" });
    const hero = await assets.createFolder({ assetType: "character", displayName: "Hero folder" });

    await withMappings.updateProjectCast("cast_project", { cast: [{ assetId: hero.asset_id, castRole: "protagonist", storyRole: "대표 캐릭터" }] });

    const created = await mappings.load("cast_project");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ asset_id: hero.asset_id, usage_role: "character", assignment_source: "auto", match_reason: "auto_cast", status: "confirmed", user_confirmed: true, enabled: true, scene_scope: { mode: "all" }, version_policy: "follow_latest" });

    await withMappings.updateProjectCast("cast_project", { cast: [] });
    expect(await mappings.load("cast_project")).toEqual([]);
  });

  it("does not auto-create a mapping alongside an existing manual mapping for the same Asset", async () => {
    const assets = new LocalAssetsRepository(root);
    const mappings = new LocalProjectAssetMappingsRepository(root);
    const withMappings = new ProjectsService(new LocalProjectRepository(root), assets, mappings);
    await withMappings.createProject({ projectId: "cast_project", topic: "topic" });
    const hero = await assets.create({ buffer: CHAR_PNG, originalname: "hero.png" }, { assetType: "character", displayName: "Hero" });
    const now = "2026-08-27T00:00:00.000Z";
    await mappings.save("cast_project", [{
      mapping_id: "MAP-MANUAL01", project_id: "cast_project", asset_id: hero.asset_id, enabled: true, usage_role: "hand-picked",
      scene_scope: { mode: "all" }, assignment_source: "manual", confidence: null, match_reason: "manual_assignment",
      status: "confirmed", user_confirmed: true, version_policy: "pinned_version", pinned_version: 1, candidate_only: false,
      created_at: now, updated_at: now, snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [],
    }]);

    await withMappings.updateProjectCast("cast_project", { cast: [{ assetId: hero.asset_id, castRole: "protagonist", storyRole: "대표 캐릭터" }] });

    const after = await mappings.load("cast_project");
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ mapping_id: "MAP-MANUAL01", assignment_source: "manual" });
  });

  it("auto-links atmosphere Assets and scene reference Assets (usage role from the user's own purpose text), and updates the role when the purpose changes", async () => {
    const assets = new LocalAssetsRepository(root);
    const mappings = new LocalProjectAssetMappingsRepository(root);
    const withMappings = new ProjectsService(new LocalProjectRepository(root), assets, mappings);
    await withMappings.createProject({ projectId: "refs_project", topic: "topic" });
    const style = await assets.create({ buffer: CHAR_PNG, originalname: "style.png" }, { assetType: "style", displayName: "Style" });
    const key = await assets.create({ buffer: SECOND_PNG, originalname: "key.png" }, { assetType: "object", displayName: "Key" });

    await withMappings.updateProjectAssetReferences("refs_project", {
      atmosphereAssetIds: [style.asset_id],
      sceneReferenceAssets: [{ assetId: key.asset_id, purpose: "주인공이 항상 들고 다니는 열쇠" }],
    });

    const created = await mappings.load("refs_project");
    expect(created).toHaveLength(2);
    expect(created.find((mapping) => mapping.asset_id === style.asset_id)).toMatchObject({ usage_role: "atmosphere", assignment_source: "auto", match_reason: "auto_atmosphere", status: "confirmed" });
    expect(created.find((mapping) => mapping.asset_id === key.asset_id)).toMatchObject({ usage_role: "주인공이 항상 들고 다니는 열쇠", assignment_source: "auto", match_reason: "auto_scene_reference" });

    await withMappings.updateProjectAssetReferences("refs_project", {
      atmosphereAssetIds: [style.asset_id],
      sceneReferenceAssets: [{ assetId: key.asset_id, purpose: "장면 3에서만 등장하는 열쇠" }],
    });
    const updated = await mappings.load("refs_project");
    expect(updated).toHaveLength(2); // same mapping_id, not a new one
    const keyMapping = updated.find((mapping) => mapping.asset_id === key.asset_id)!;
    expect(keyMapping.usage_role).toBe("장면 3에서만 등장하는 열쇠");
    expect(keyMapping.mapping_id).toBe(created.find((mapping) => mapping.asset_id === key.asset_id)!.mapping_id);
  });

  it("skips auto-linking entirely when no mappings repository is injected", async () => {
    await service.createProject({ projectId: "cast_project", topic: "topic" });
    const saved = await service.updateProjectCast("cast_project", { cast: [{ assetId: "ASSET-CHAR-ANY", castRole: "protagonist", storyRole: "대표 캐릭터" }] });
    expect(saved.cast).toHaveLength(1); // no throw despite the missing repository
  });

  it("has no continuity link or options before any other project exists", async () => {
    await service.createProject({ projectId: "current", topic: "topic" });
    expect(await service.getProjectContinuity("current")).toEqual({ link: null });
    expect(await service.listProjectContinuityOptions("current")).toEqual({ options: [] });
  });

  it("links, reflects, and disconnects a Scene 6 continuity source from another eligible project", async () => {
    await service.createProject({ projectId: "current", topic: "topic" });
    const candidateId = "candidate";
    const imagesDir = path.join(root, candidateId, "images");
    await service.createProject({ projectId: candidateId, topic: "candidate topic" });
    const repository = new LocalProjectRepository(root);
    const candidate = await repository.findById(candidateId);
    await repository.save({
      ...candidate, workflow_state: WorkflowState.VideosReady,
      scenes: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, description: `Scene ${i + 1}` })),
      story: { title: "Candidate Story", synopsis: "s", ending: "ending" },
      generated_images: Array.from({ length: 6 }, (_, i) => path.join(imagesDir, `scene${i + 1}.png`)),
    });
    await fsPromises.mkdir(imagesDir, { recursive: true });
    await fsPromises.writeFile(path.join(imagesDir, "scene6.png"), "fake-png-bytes");

    const options = await service.listProjectContinuityOptions("current");
    expect(options.options).toEqual([{ projectId: candidateId, projectName: "Candidate Story", label: "Candidate Story · Scene 6" }]);

    const linked = await service.updateProjectContinuity("current", { projectId: candidateId });
    expect(linked).toEqual({ link: { projectId: candidateId, projectName: "Candidate Story", label: "Candidate Story · Scene 6" } });
    expect(await service.getProjectContinuity("current")).toEqual(linked);

    const disconnected = await service.updateProjectContinuity("current", { projectId: null });
    expect(disconnected).toEqual({ link: null });
    expect(await service.getProjectContinuity("current")).toEqual({ link: null });
  });

  it("links a continuity source using its own actual final scene (not a fixed Scene 6) for a four-scene project", async () => {
    await service.createProject({ projectId: "current", topic: "topic" });
    const candidateId = "candidate_four";
    const imagesDir = path.join(root, candidateId, "images");
    await service.createProject({ projectId: candidateId, topic: "candidate topic" });
    const repository = new LocalProjectRepository(root);
    const candidate = await repository.findById(candidateId);
    await repository.save({
      ...candidate, workflow_state: WorkflowState.VideosReady,
      scenes: Array.from({ length: 4 }, (_, i) => ({ number: i + 1, description: `Scene ${i + 1}` })),
      story: { title: "Four Scene Story", synopsis: "s", ending: "ending" },
      generated_images: Array.from({ length: 4 }, (_, i) => path.join(imagesDir, `scene${i + 1}.png`)),
    });
    await fsPromises.mkdir(imagesDir, { recursive: true });
    await fsPromises.writeFile(path.join(imagesDir, "scene4.png"), "fake-png-bytes");

    const options = await service.listProjectContinuityOptions("current");
    expect(options.options).toEqual([{ projectId: candidateId, projectName: "Four Scene Story", label: "Four Scene Story · Scene 4" }]);

    const linked = await service.updateProjectContinuity("current", { projectId: candidateId });
    expect(linked).toEqual({ link: { projectId: candidateId, projectName: "Four Scene Story", label: "Four Scene Story · Scene 4" } });
  });

  it("rejects linking to a project that is not eligible or does not exist", async () => {
    await service.createProject({ projectId: "current", topic: "topic" });
    await expect(service.updateProjectContinuity("current", { projectId: "missing" })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects a continuity request body with fields other than projectId", async () => {
    await service.createProject({ projectId: "current", topic: "topic" });
    await expect(service.updateProjectContinuity("current", { projectId: null, extra: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
});
