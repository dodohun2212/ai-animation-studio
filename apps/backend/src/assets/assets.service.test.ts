import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "./assets.repository.js";
import { AssetsService } from "./assets.service.js";

const roots: string[] = [];
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const secondImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("AssetsService", () => {
  it("supports search/type filtering and hides storage paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const service = new AssetsService(new LocalAssetsRepository(root));
    const created = await service.create({ buffer: image, originalname: "city.png" }, JSON.stringify({ assetType: "background", displayName: "Night City", aliases: ["Seoul"] }));
    expect((await service.list("seo", "background")).assets).toHaveLength(1);
    expect(JSON.stringify(created)).not.toContain("stored_path");
    expect(JSON.stringify(created)).not.toContain(root);
    expect(await service.get(created.asset.assetId)).toMatchObject({ ownership: "library_manual", canDeleteOwnedFile: true });
  });
  it("rejects unknown request fields and invalid face/type combinations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const service = new AssetsService(new LocalAssetsRepository(root));
    await expect(service.create({ buffer: image, originalname: "city.png" }, { assetType: "background", displayName: "city", surprise: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.create({ buffer: image, originalname: "city.png" }, { assetType: "background", displayName: "city", faceBaseline: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
  it("returns a safe error when indexed image bytes disappear", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const repository = new LocalAssetsRepository(root); const service = new AssetsService(repository);
    const created = await service.create({ buffer: image, originalname: "사라진_파일.png", mimetype: "image/png" }, { assetType: "background", displayName: "사라진 파일" });
    const stored = await repository.get(created.asset.assetId); await fs.unlink(stored.stored_path);
    await expect(service.content(created.asset.assetId)).rejects.toMatchObject({ response: { code: "ASSET_FILE_INVALID" } });
  });
  it("does not claim owned-file deletion safety for shared image bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const repository = new LocalAssetsRepository(root); const service = new AssetsService(repository);
    const created = await service.create({ buffer: image, originalname: "공유.png", mimetype: "image/png" }, { assetType: "background", displayName: "공유 원본" });
    const indexPath = path.join(root, "asset_library", "assets.json"); const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    records.push({ ...records[0], asset_id: "ASSET-BG-SHARED", display_name: "공유 링크" }); await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
    expect((await service.get(created.asset.assetId)).canDeleteOwnedFile).toBe(false);
  });

  it("reorders a Character Folder reference set and changes only its selected representative", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const repository = new LocalAssetsRepository(root); const service = new AssetsService(repository);
    const first = await service.create({ buffer: image, originalname: "front.png", mimetype: "image/png" }, { assetType: "character", displayName: "Character front" });
    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    const secondId = "ASSET-CHAR-SECOND";
    const second = { ...records[0]!, asset_id: secondId, display_name: "Character side", role: "side" };
    const folderId = "FOLDER-CHARACTER";
    records[0]!.parent_folder_id = folderId; records[0]!.sort_order = 0;
    second.parent_folder_id = folderId; second.sort_order = 1;
    records.push(second, {
      ...records[0]!, asset_id: folderId, asset_type: "character", display_name: "Character reference set",
      stored_path: "", original_filename: "", content_sha256: "", versions: [], reference_images: [], reference_roles: [],
      is_folder: true, parent_folder_id: "", child_asset_ids: [first.asset.assetId, secondId], thumbnail_asset_id: first.asset.assetId,
      role: "", sort_order: 0,
    });
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");

    const updated = await service.updateCharacterFolderReferenceSet(folderId, {
      childAssetIds: [secondId, first.asset.assetId], thumbnailAssetId: secondId,
    });
    expect(updated.folder.childAssetIds).toEqual([secondId, first.asset.assetId]);
    expect(updated.folder.thumbnailAssetId).toBe(secondId);
    expect(updated.children.map((asset) => [asset.assetId, asset.sortOrder])).toEqual([[secondId, 0], [first.asset.assetId, 1]]);
    expect((await service.content(folderId)).path).toBe((await repository.get(secondId)).stored_path);
    await expect(service.updateCharacterFolderReferenceSet(folderId, {
      childAssetIds: [first.asset.assetId], thumbnailAssetId: first.asset.assetId,
    })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("creates an empty Character Folder, then links and unlinks an existing Asset as its child", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const repository = new LocalAssetsRepository(root); const service = new AssetsService(repository);

    await expect(service.createFolder({ assetType: "character", displayName: "" })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.createFolder({ displayName: "주인공" })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const folder = await service.createFolder({ assetType: "character", displayName: "주인공", notes: "메인 캐릭터" });
    expect(folder.asset).toMatchObject({ isFolder: true, assetType: "character", displayName: "주인공", childAssetIds: [], contentUrl: null });

    const created = await service.create({ buffer: image, originalname: "front.png" }, { assetType: "general_reference", displayName: "정면" });
    expect(created.asset.assetType).toBe("general_reference");

    const linked = await service.setParentFolder(created.asset.assetId, { parentFolderId: folder.asset.assetId });
    expect(linked.asset).toMatchObject({ parentFolderId: folder.asset.assetId, assetType: "character", sortOrder: 0 });
    expect(linked.folder).toMatchObject({ assetId: folder.asset.assetId, childAssetIds: [created.asset.assetId], thumbnailAssetId: created.asset.assetId });

    const unlinked = await service.setParentFolder(created.asset.assetId, { parentFolderId: null });
    expect(unlinked.asset.parentFolderId).toBe("");
    expect(unlinked.folder).toMatchObject({ childAssetIds: [], thumbnailAssetId: "" });

    await expect(service.setParentFolder(created.asset.assetId, { parentFolderId: created.asset.assetId })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.setParentFolder(created.asset.assetId, { parentFolderId: created.asset.assetId, extra: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const notAFolder = await service.create({ buffer: secondImage, originalname: "other.png" }, { assetType: "background", displayName: "배경" });
    await expect(service.setParentFolder(created.asset.assetId, { parentFolderId: notAFolder.asset.assetId })).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
  });

  it("supports a Folder of a non-character type without forcing character-only role/reference-image scaffolding onto its children", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const repository = new LocalAssetsRepository(root); const service = new AssetsService(repository);
    const folder = await service.createFolder({ assetType: "background", displayName: "City skylines", description: "Neon-lit night skylines across the story" });
    expect(folder.asset).toMatchObject({ isFolder: true, assetType: "background" });

    const child = await service.create({ buffer: image, originalname: "night.png" }, { assetType: "background", displayName: "밤 스카이라인", description: "네온사인이 켜진 밤거리" });
    const linked = await service.setParentFolder(child.asset.assetId, { parentFolderId: folder.asset.assetId });
    expect(linked.asset).toMatchObject({ assetType: "background", parentFolderId: folder.asset.assetId, role: "", description: "네온사인이 켜진 밤거리" });
    expect(linked.asset.referenceImages).toEqual([]);
  });

  it("re-parents an Asset directly from one Character Folder to another", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const repository = new LocalAssetsRepository(root); const service = new AssetsService(repository);
    const folderA = await service.createFolder({ assetType: "character", displayName: "A" });
    const folderB = await service.createFolder({ assetType: "character", displayName: "B" });
    const child = await service.create({ buffer: image, originalname: "front.png" }, { assetType: "character", displayName: "정면" });

    await service.setParentFolder(child.asset.assetId, { parentFolderId: folderA.asset.assetId });
    const moved = await service.setParentFolder(child.asset.assetId, { parentFolderId: folderB.asset.assetId });
    expect(moved.folder).toMatchObject({ assetId: folderB.asset.assetId, childAssetIds: [child.asset.assetId] });
    expect((await service.get(folderA.asset.assetId)).asset.childAssetIds).toEqual([]);
  });

  it("adds a version, relinks and audits without exposing storage paths, and rejects a missing file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const repository = new LocalAssetsRepository(root); const service = new AssetsService(repository);
    const created = await service.create({ buffer: image, originalname: "city.png" }, { assetType: "background", displayName: "Night City" });
    await expect(service.addVersion(created.asset.assetId, undefined, "note")).rejects.toMatchObject({ response: { code: "ASSET_FILE_INVALID" } });
    await expect(service.addVersion(created.asset.assetId, { buffer: secondImage, originalname: "v2.png" }, { bad: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const versioned = await service.addVersion(created.asset.assetId, { buffer: secondImage, originalname: "v2.png" }, "재촬영");
    expect(versioned.asset.version).toBe(2);
    expect(versioned.asset.versions).toEqual([
      { version: 1, contentSha256: created.asset.contentSha256, createdAt: created.asset.createdAt, notes: "" },
      { version: 2, contentSha256: versioned.asset.contentSha256, createdAt: versioned.asset.updatedAt, notes: "재촬영" },
    ]);
    expect(JSON.stringify(versioned)).not.toContain(root);

    const relinked = await service.relink(created.asset.assetId, { buffer: image, originalname: "back.png" });
    expect(relinked.asset.assetId).toBe(created.asset.assetId);
    expect(relinked.asset.contentSha256).toBe(created.asset.contentSha256);
    expect(JSON.stringify(relinked)).not.toContain(root);

    const audit = await service.audit();
    expect(audit.entries).toContainEqual({ assetId: created.asset.assetId, displayName: "Night City", classification: "healthy", sourceKind: "manual", message: "" });
    expect(JSON.stringify(audit)).not.toContain(root);
  });

  it("deletes a Folder and, when requested, its child indexes without exposing storage paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const repository = new LocalAssetsRepository(root); const service = new AssetsService(repository);
    const first = await service.create({ buffer: image, originalname: "a.png" }, { assetType: "background", displayName: "A" });
    const second = await service.create({ buffer: secondImage, originalname: "b.png" }, { assetType: "background", displayName: "B" });
    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    const folderId = "FOLDER-SERVICE-TEST";
    for (const record of records) if (record.asset_id === first.asset.assetId || record.asset_id === second.asset.assetId) record.parent_folder_id = folderId;
    records.push({
      asset_id: folderId, asset_type: "background", display_name: "Service Folder", description: "", stored_path: "", original_filename: "", content_sha256: "",
      tags: [], aliases: [], enabled: true, approved: false, face_baseline: false, character_key: null, version: 1, versions: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), notes: "", legacy_asset_ids: [], status: "manual",
      source_project_id: "", source_scene_number: null, reference_images: [], reference_roles: [], is_folder: true, parent_folder_id: "",
      child_asset_ids: [first.asset.assetId, second.asset.assetId], thumbnail_asset_id: first.asset.assetId, role: "", sort_order: 0,
    });
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");

    await expect(service.removeFolder(folderId, "not-a-boolean")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const response = await service.removeFolder(folderId, "true", "false");
    expect(response.assetId).toBe(folderId);
    expect(response.removedChildAssetIds.sort()).toEqual([first.asset.assetId, second.asset.assetId].sort());
    expect(response.deletedFiles).toBe(0);
    expect(JSON.stringify(response)).not.toContain(root);
    expect(await service.list()).toEqual({ assets: [] });
  });

  it("deletes a manual Asset's owned file only through the explicit owned-file route", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-service-")); roots.push(root);
    const repository = new LocalAssetsRepository(root); const service = new AssetsService(repository);
    const created = await service.create({ buffer: image, originalname: "city.png" }, { assetType: "background", displayName: "Night City" });
    const contentPath = repository.resolveContentPath(await repository.get(created.asset.assetId))!;
    const response = await service.removeOwnedFile(created.asset.assetId);
    expect(response).toEqual({ assetId: created.asset.assetId, deletedOwnedFile: true });
    await expect(fs.access(contentPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(service.get(created.asset.assetId)).rejects.toMatchObject({ response: { code: "ASSET_NOT_FOUND" } });
  });
});
