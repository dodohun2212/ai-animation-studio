import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "./assets.repository.js";
import { AssetsService } from "./assets.service.js";

const roots: string[] = [];
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
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
});
