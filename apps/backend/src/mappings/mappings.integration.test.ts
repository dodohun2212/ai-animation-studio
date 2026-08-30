import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProjectAssetMappingsService } from "./mappings.service.js";
import { ShortProjectMappingOwners } from "./short-project-mapping-owner.js";
import { LocalProjectAssetMappingsRepository } from "./mappings.repository.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

async function setup(sceneCount = 6) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-mapping-"));
  const projectsRoot = path.join(root, "projects"); const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("short_mapping", "Asset mapping", "2026-08-22T00:00:00.000Z");
  project.script_revision = 1;
  project.scenes = Array.from({ length: sceneCount }, (_, index) => ({ number: index + 1, description: `scene ${index + 1}` }));
  // The settings are what the scene count is read from, and what create() validates a scope against. Setting the
  // scenes without them would build a project that cannot exist — approval refuses that pair outright.
  project.lore_context = { ...project.lore_context, scene_count: sceneCount };
  await projects.create(project);
  const assets = new LocalAssetsRepository(root);
  const asset = await assets.create({ buffer: png, originalname: "fixture.png", mimetype: "image/png" }, { assetType: "style", displayName: "Fixture style" });
  const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
  return { assets, asset, mappings, service: new ProjectAssetMappingsService(mappings, assets, new ShortProjectMappingOwners(mappings)), project };
}

describe("ProjectAssetMappingsService", () => {
  it("reports the owner's own scene count, so a scene picker offers only scenes the server will accept", async () => {
    // The screen listed 1..MAX_SCENE_COUNT and this project has four scenes, so it offered scene five and the
    // server refused it — the app proposing a choice it does not accept. Both halves are asserted together
    // because the value only means anything if it agrees with what create() allows; a constant six would satisfy
    // neither, and reporting a count nothing enforces would satisfy the first alone.
    const { service, asset } = await setup(4);
    expect((await service.review("short_mapping")).sceneCount).toBe(4);

    await expect(service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "scene", sceneNumber: 5 } }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const withinRange = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "scene", sceneNumber: 4 } });
    expect(withinRange.mapping.sceneScope).toEqual({ kind: "scene", sceneNumber: 4 });
  });

  it("creates, lists, snapshots, reviews and reopens local project mappings", async () => {
    const { service, asset, mappings, assets } = await setup();
    const created = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    expect(created.mapping).toMatchObject({ projectId: "short_mapping", assetId: asset.asset_id, status: "confirmed", versionPolicy: "pinned_version" });
    const snapshot = await service.snapshot("short_mapping", created.mapping.mappingId);
    expect(snapshot.mapping.snapshot).toMatchObject({ relativePath: expect.stringMatching(/^asset_snapshots\/MAP-/), sourceVersion: 1 });
    expect(snapshot.mapping.snapshot?.relativePath).not.toContain("\\");
    const listed = await service.list("short_mapping");
    expect(listed.mappings).toHaveLength(1);
    const begun = await service.beginReview("short_mapping", { scriptRevision: 1 });
    const approved = await service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint });
    expect(approved.review).toMatchObject({ status: "approved", reviewedScenes: [1, 2, 3, 4, 5, 6] });
    const reopened = await new ProjectAssetMappingsService(mappings, assets, new ShortProjectMappingOwners(mappings)).list("short_mapping");
    expect(reopened.mappings[0]?.snapshot?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps a Folder Asset as follow_latest only, rejecting a pinned/snapshot policy since a Folder has no versions of its own", async () => {
    const { service, assets, project } = await setup();
    const folder = await assets.createFolder({ assetType: "style", displayName: "City moods" });
    const child = await assets.create({ buffer: png, originalname: "night.png", mimetype: "image/png" }, { assetType: "style", displayName: "Night mood" });
    await assets.setParentFolder(child.asset_id, folder.asset_id);

    const created = await service.create(project.project_id, { assetId: folder.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    expect(created.mapping).toMatchObject({ assetId: folder.asset_id, versionPolicy: "follow_latest" });

    await expect(service.create(project.project_id, { assetId: folder.asset_id, usageRole: "style", sceneScope: { kind: "all" }, versionPolicy: "pinned_version" }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.update(project.project_id, created.mapping.mappingId, { versionPolicy: "pinned_version" }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("invalidates review on mapping changes and on script fingerprint changes", async () => {
    const { service, asset, project } = await setup();
    const created = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    const begun = await service.beginReview("short_mapping", { scriptRevision: 1 });
    await service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint });
    const updated = await service.update("short_mapping", created.mapping.mappingId, { decision: "exclude" });
    expect(updated.review.status).toBe("waiting");
    const startedAgain = await service.beginReview("short_mapping", { scriptRevision: 1 });
    project.scenes[5] = { number: 6, description: "changed" };
    await fs.writeFile(path.join(root!, "projects", "short_mapping", "project.json"), JSON.stringify(project), "utf8");
    await expect(service.approveReview("short_mapping", { scriptFingerprint: startedAgain.review.scriptFingerprint })).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_FINGERPRINT_MISMATCH" } });
    expect((await service.review("short_mapping")).review.status).toBe("waiting");
  });

  it("blocks approval on a suggested mapping carried over from the Python baseline", async () => {
    // Nothing this port writes produces `suggested` — every mapping it creates is confirmed or excluded — so
    // this condition looks dead from the TypeScript side alone. It is not. `app/services/project_asset_mapping.py`
    // wrote `suggested` and `ambiguous` from its auto-matcher and `unmatched` from mark_scene_unmatched, and
    // parseStored defaults an absent status to `suggested` besides. A file from before the migration therefore
    // still arrives with one, and approving it would send the image model a reference nobody ever confirmed.
    // Written to disk rather than through the API on purpose: the API is exactly what cannot produce this.
    const { service, asset, project } = await setup();
    const now = "2026-08-30T00:00:00.000Z";
    // No `status` field at all, which is how the oldest of those files look — parseStored fills in `suggested`.
    await fs.writeFile(path.join(root!, "projects", project.project_id, "asset_mappings.json"), JSON.stringify([{
      mapping_id: "MAP-LEGACY", project_id: project.project_id, asset_id: asset.asset_id, usage_role: "style",
      scene_scope: { mode: "all" }, assignment_source: "auto", created_at: now, updated_at: now,
    }]), "utf8");

    const begun = await service.beginReview("short_mapping", { scriptRevision: 1, textOnlyConfirmed: true });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint }))
      .rejects.toMatchObject({ response: { code: "ASSET_MAPPING_APPROVAL_BLOCKED", details: { mappingIds: ["MAP-LEGACY"] } } });

    // And it clears the ordinary way: confirming the suggestion.
    await service.update("short_mapping", "MAP-LEGACY", { decision: "confirm" });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint }))
      .resolves.toMatchObject({ review: { status: "approved" } });
  });

  it("blocks approval when no mapping is explicitly text-only or legacy-confirmed", async () => {
    const { service } = await setup();
    const begun = await service.beginReview("short_mapping", { scriptRevision: 1 });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint })).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_APPROVAL_BLOCKED" } });
    const textOnly = await service.beginReview("short_mapping", { scriptRevision: 1, textOnlyConfirmed: true });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: textOnly.review.scriptFingerprint })).resolves.toMatchObject({ review: { status: "approved" } });
  });

  it("rejects snapshot sources whose legacy version path or junction escapes learning_data", async () => {
    const { service, asset } = await setup();
    const created = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    const indexPath = path.join(root!, "asset_library", "assets.json"); const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mapping-outside-"));
    try {
      const outsideFile = path.join(outside, "outside.png"); await fs.writeFile(outsideFile, png);
      records[0]!.stored_path = outsideFile; (records[0]!.versions as Array<Record<string, unknown>>)[0]!.stored_path = outsideFile;
      await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
      await expect(service.snapshot("short_mapping", created.mapping.mappingId)).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_SNAPSHOT_INVALID" } });
      const linked = path.join(root!, "linked-outside"); await fs.symlink(outside, linked, "junction");
      records[0]!.stored_path = path.join(linked, "outside.png"); (records[0]!.versions as Array<Record<string, unknown>>)[0]!.stored_path = path.join(linked, "outside.png");
      await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
      await expect(service.snapshot("short_mapping", created.mapping.mappingId)).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_SNAPSHOT_INVALID" } });
    } finally { await fs.rm(outside, { recursive: true, force: true }); }
  });
});
