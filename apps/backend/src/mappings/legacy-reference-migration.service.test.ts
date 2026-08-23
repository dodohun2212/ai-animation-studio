import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LegacyReferenceMigrationService } from "./legacy-reference-migration.service.js";
import { LocalProjectAssetMappingsRepository } from "./mappings.repository.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const secondPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-reference-migration-"));
  const projectsRoot = path.join(root, "projects");
  const assets = new LocalAssetsRepository(root);
  const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
  const service = new LegacyReferenceMigrationService(assets, mappings, root);
  return { root, projectsRoot, assets, mappings, service };
}

async function createProject(projectsRoot: string, projectId: string): Promise<void> {
  const projects = new LocalProjectRepository(projectsRoot);
  await projects.create(createStoredProject(projectId, "Legacy topic", "2026-08-22T00:00:00.000Z"));
}

async function writeLegacyReferences(projectsRoot: string, projectId: string, entries: unknown[]): Promise<string> {
  const directory = path.join(projectsRoot, projectId, "reference_assets");
  await fs.mkdir(directory, { recursive: true });
  const imagePath = path.join(directory, "RA-000000000001.png");
  await fs.writeFile(imagePath, png);
  await fs.writeFile(path.join(directory, "references.json"), JSON.stringify(entries), "utf8");
  return imagePath;
}

const legacyEntry = (overrides: Record<string, unknown> = {}) => ({
  asset_id: "RA-000000000001", project_id: "legacy_project", stored_path: "reference_assets/RA-000000000001.png",
  original_filename: "hero.png", display_name: "레거시 캐릭터", source: "manual_upload", reference_type: "character",
  enabled: true, scene_scope: { mode: "all" }, episode_scope: { mode: "all" }, notes: "이전됨",
  character_id: "hero", face_baseline: true, content_sha256: "", ...overrides,
});

describe("LegacyReferenceMigrationService", () => {
  it("migrates a legacy Reference into the Library with a confirmed migrated mapping, then is idempotent", async () => {
    const { projectsRoot, assets, mappings, service } = await setup();
    await createProject(projectsRoot, "legacy_project");
    await writeLegacyReferences(projectsRoot, "legacy_project", [legacyEntry()]);

    const report = await service.migrateAll();
    expect(report).toEqual({ projectsScanned: 1, migratedAssets: 1, deduplicatedAssets: 0, failedAssets: 0 });

    const libraryAssets = await assets.list();
    expect(libraryAssets).toHaveLength(1);
    expect(libraryAssets[0]).toMatchObject({ display_name: "레거시 캐릭터", character_key: "hero", face_baseline: true, legacy_asset_ids: ["RA-000000000001"] });

    const storedMappings = await mappings.load("legacy_project");
    expect(storedMappings).toHaveLength(1);
    expect(storedMappings[0]).toMatchObject({
      project_id: "legacy_project", asset_id: libraryAssets[0]!.asset_id, assignment_source: "migrated",
      status: "confirmed", user_confirmed: true, version_policy: "pinned_version", pinned_version: 1, usage_role: "character",
    });
    const review = await mappings.loadReview("legacy_project");
    expect(review.mapping_revision).toBeGreaterThan(0);

    const secondReport = await service.migrateAll();
    expect(secondReport).toEqual({ projectsScanned: 1, migratedAssets: 0, deduplicatedAssets: 0, failedAssets: 0 });
    expect(await assets.list()).toHaveLength(1);
    expect(await mappings.load("legacy_project")).toHaveLength(1);
  });

  it("deduplicates identical bytes across two projects into one Asset while giving each project its own mapping", async () => {
    const { projectsRoot, assets, mappings, service } = await setup();
    await createProject(projectsRoot, "project_a");
    await createProject(projectsRoot, "project_b");
    await writeLegacyReferences(projectsRoot, "project_a", [legacyEntry({ project_id: "project_a" })]);
    const directoryB = path.join(projectsRoot, "project_b", "reference_assets");
    await fs.mkdir(directoryB, { recursive: true });
    await fs.writeFile(path.join(directoryB, "RA-000000000001.png"), png);
    await fs.writeFile(path.join(directoryB, "references.json"), JSON.stringify([legacyEntry({ project_id: "project_b" })]), "utf8");

    const report = await service.migrateAll();
    expect(report).toEqual({ projectsScanned: 2, migratedAssets: 2, deduplicatedAssets: 1, failedAssets: 0 });
    expect(await assets.list()).toHaveLength(1);
    expect((await mappings.load("project_a"))).toHaveLength(1);
    expect((await mappings.load("project_b"))).toHaveLength(1);
  });

  it("skips a project with no legacy reference file and never touches its mappings", async () => {
    const { projectsRoot, mappings, service } = await setup();
    await createProject(projectsRoot, "plain_project");
    const report = await service.migrateAll();
    expect(report).toEqual({ projectsScanned: 0, migratedAssets: 0, deduplicatedAssets: 0, failedAssets: 0 });
    expect(await mappings.load("plain_project")).toEqual([]);
  });

  it("does not let one project's damaged legacy file block migration for another project", async () => {
    const { projectsRoot, assets, service } = await setup();
    await createProject(projectsRoot, "damaged_project");
    await createProject(projectsRoot, "healthy_project");
    const damagedDirectory = path.join(projectsRoot, "damaged_project", "reference_assets");
    await fs.mkdir(damagedDirectory, { recursive: true });
    await fs.writeFile(path.join(damagedDirectory, "references.json"), "{ not valid json", "utf8");
    await writeLegacyReferences(projectsRoot, "healthy_project", [legacyEntry({ project_id: "healthy_project" })]);

    const report = await service.migrateAll();
    expect(report.projectsScanned).toBe(2);
    expect(report.migratedAssets).toBe(1);
    expect(report.failedAssets).toBeGreaterThan(0);
    expect(await assets.list()).toHaveLength(1);
  });

  it("counts a legacy entry with a path that escapes its project directory as a failure without importing it", async () => {
    const { projectsRoot, assets, mappings, service } = await setup();
    await createProject(projectsRoot, "escape_project");
    const directory = path.join(projectsRoot, "escape_project", "reference_assets");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "references.json"), JSON.stringify([
      legacyEntry({ project_id: "escape_project", stored_path: "../../../etc/passwd" }),
    ]), "utf8");

    const report = await service.migrateAll();
    expect(report).toEqual({ projectsScanned: 1, migratedAssets: 0, deduplicatedAssets: 0, failedAssets: 1 });
    expect(await assets.list()).toEqual([]);
    expect(await mappings.load("escape_project")).toEqual([]);
  });

  it("imports a non-character legacy Reference and reuses the second image's bytes to import a distinct Asset", async () => {
    const { projectsRoot, assets, mappings, service } = await setup();
    await createProject(projectsRoot, "style_project");
    const directory = path.join(projectsRoot, "style_project", "reference_assets");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "RA-000000000001.png"), png);
    await fs.writeFile(path.join(directory, "RA-000000000002.png"), secondPng);
    await fs.writeFile(path.join(directory, "references.json"), JSON.stringify([
      legacyEntry({ project_id: "style_project", reference_type: "style", character_id: null, face_baseline: false }),
      legacyEntry({ asset_id: "RA-000000000002", project_id: "style_project", stored_path: "reference_assets/RA-000000000002.png", reference_type: "background", character_id: null, face_baseline: false, display_name: "레거시 배경" }),
    ]), "utf8");

    const report = await service.migrateAll();
    expect(report).toEqual({ projectsScanned: 1, migratedAssets: 2, deduplicatedAssets: 0, failedAssets: 0 });
    const libraryAssets = await assets.list();
    expect(libraryAssets.map((asset) => asset.asset_type).sort()).toEqual(["background", "style"]);
    expect((await mappings.load("style_project")).map((mapping) => mapping.usage_role).sort()).toEqual(["background", "style"]);
  });
});
