import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
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
