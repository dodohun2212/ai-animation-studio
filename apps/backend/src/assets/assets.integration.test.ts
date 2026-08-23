import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";
import { AssetsController } from "./assets.controller.js";
import { LocalAssetsRepository } from "./assets.repository.js";
import { AssetsService } from "./assets.service.js";

const roots: string[] = [];
const apps: Array<{ close(): Promise<void> }> = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Asset Library HTTP and restart integration", () => {
  it("imports, lists, streams, updates, and reopens from a fresh Nest instance", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-http-")); roots.push(root);
    const start = async () => {
      const service = new AssetsService(new LocalAssetsRepository(root));
      class TestModule {}
      Module({ controllers: [AssetsController], providers: [{ provide: AssetsService, useValue: service }] })(TestModule);
      const app = await NestFactory.create(TestModule, { logger: false });
      await app.listen(0, "127.0.0.1"); apps.push(app);
      const address = app.getHttpServer().address() as { port: number };
      return { app, base: `http://127.0.0.1:${address.port}` };
    };
    const first = await start();
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "city.png");
    form.append("metadata", JSON.stringify({ assetType: "background", displayName: "Night City", tags: ["night"] }));
    const createdResponse = await fetch(`${first.base}/assets`, { method: "POST", body: form });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { asset: { assetId: string; contentUrl: string } };
    expect(created.asset.assetId).toMatch(/^ASSET-BG-/);
    const contentResponse = await fetch(`${first.base}${created.asset.contentUrl}`);
    expect(contentResponse.headers.get("content-type")).toBe("image/png");
    expect(contentResponse.headers.get("content-length")).toBe(String(png.length));
    expect(contentResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(contentResponse.headers.get("content-disposition")).toBe('inline; filename="asset.png"');
    expect(Buffer.from(await contentResponse.arrayBuffer())).toEqual(png);
    await first.app.close(); apps.splice(apps.indexOf(first.app), 1);

    const restarted = await start();
    const listed = await (await fetch(`${restarted.base}/assets?query=night&assetType=background`)).json() as { assets: Array<{ assetId: string }> };
    expect(listed.assets.map((asset) => asset.assetId)).toEqual([created.asset.assetId]);
    const patchResponse = await fetch(`${restarted.base}/assets/${created.asset.assetId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "Updated City" }),
    });
    expect(patchResponse.status).toBe(200);
    expect(JSON.stringify(await patchResponse.json())).not.toContain(root);
    const deleted = await fetch(`${restarted.base}/assets/${created.asset.assetId}`, { method: "DELETE" });
    expect(await deleted.json()).toEqual({ assetId: created.asset.assetId, deletedOwnedFile: false });
  });

  it("maps strict multipart failures to the safe ApiError envelope", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-http-")); roots.push(root);
    const service = new AssetsService(new LocalAssetsRepository(root));
    class TestModule {}
    Module({ controllers: [AssetsController], providers: [{ provide: AssetsService, useValue: service }] })(TestModule);
    const app = await NestFactory.create(TestModule, { logger: false }); await app.listen(0, "127.0.0.1"); apps.push(app);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/jpeg" }), "잘못된_MIME.png");
    form.append("metadata", JSON.stringify({ assetType: "background", displayName: "오류 확인" }));
    form.append("unknown", "not allowed");
    const response = await fetch(`http://127.0.0.1:${port}/assets`, { method: "POST", body: form });
    expect(response.status).toBe(400);
    const body = await response.json() as { code: string; message: string };
    expect(body.code).toMatch(/^(?:INVALID_REQUEST|ASSET_FILE_INVALID)$/);
    expect(body.message).not.toContain(root);
  });

  it("updates only an existing Character Folder's child order and representative through the dedicated route", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-http-folder-")); roots.push(root);
    const service = new AssetsService(new LocalAssetsRepository(root));
    class TestModule {}
    Module({ controllers: [AssetsController], providers: [{ provide: AssetsService, useValue: service }] })(TestModule);
    const app = await NestFactory.create(TestModule, { logger: false }); await app.listen(0, "127.0.0.1"); apps.push(app);
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "front.png");
    form.append("metadata", JSON.stringify({ assetType: "character", displayName: "Character front" }));
    const created = await (await fetch(`${base}/assets`, { method: "POST", body: form })).json() as { asset: { assetId: string } };
    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    const childId = "ASSET-CHAR-SECOND"; const folderId = "FOLDER-CHARACTER";
    const second = { ...records[0]!, asset_id: childId, display_name: "Character side", parent_folder_id: folderId, sort_order: 1 };
    records[0]!.parent_folder_id = folderId; records[0]!.sort_order = 0;
    records.push(second, {
      ...records[0]!, asset_id: folderId, asset_type: "character", display_name: "Character references", stored_path: "",
      original_filename: "", content_sha256: "", versions: [], reference_images: [], reference_roles: [], is_folder: true,
      parent_folder_id: "", child_asset_ids: [created.asset.assetId, childId], thumbnail_asset_id: created.asset.assetId, role: "", sort_order: 0,
    });
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");

    const response = await fetch(`${base}/assets/${folderId}/character-reference-set`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ childAssetIds: [childId, created.asset.assetId], thumbnailAssetId: childId }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ folder: { childAssetIds: [childId, created.asset.assetId], thumbnailAssetId: childId } });
    const content = await fetch(`${base}/assets/${folderId}/content`);
    expect(content.status).toBe(200);
    await expect(fetch(`${base}/assets/${folderId}/character-reference-set`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ childAssetIds: [created.asset.assetId], thumbnailAssetId: created.asset.assetId }),
    })).resolves.toMatchObject({ status: 400 });
  });

  it("returns exact safe error codes for every multipart boundary", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-http-table-")); roots.push(root);
    const service = new AssetsService(new LocalAssetsRepository(root));
    class TestModule {}
    Module({ controllers: [AssetsController], providers: [{ provide: AssetsService, useValue: service }] })(TestModule);
    const app = await NestFactory.create(TestModule, { logger: false }); await app.listen(0, "127.0.0.1"); apps.push(app);
    const url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/assets`;
    const metadata = JSON.stringify({ assetType: "background", displayName: "업로드 오류표" });
    const imagePart = () => new Blob([png], { type: "image/png" });
    const cases: Array<[string, BodyInit, string]> = [];
    const missing = new FormData(); missing.append("metadata", metadata); cases.push(["missing file", missing, "ASSET_FILE_INVALID"]);
    const unknown = new FormData(); unknown.append("image", imagePart(), "image.png"); unknown.append("metadata", metadata); unknown.append("unknown", "x"); cases.push(["unknown field", unknown, "ASSET_FILE_INVALID"]);
    const second = new FormData(); second.append("image", imagePart(), "one.png"); second.append("image", imagePart(), "two.png"); second.append("metadata", metadata); cases.push(["second file", second, "ASSET_FILE_INVALID"]);
    const duplicateMetadata = new FormData(); duplicateMetadata.append("image", imagePart(), "image.png"); duplicateMetadata.append("metadata", metadata); duplicateMetadata.append("metadata", metadata); cases.push(["duplicate metadata", duplicateMetadata, "ASSET_FILE_INVALID"]);
    const largeMetadata = new FormData(); largeMetadata.append("image", imagePart(), "image.png"); largeMetadata.append("metadata", "x".repeat(1024 * 1024 + 1)); cases.push(["oversized metadata", largeMetadata, "ASSET_FILE_INVALID"]);
    const largeFile = new FormData(); largeFile.append("image", new Blob([png, new Uint8Array(25 * 1024 * 1024)], { type: "image/png" }), "large.png"); largeFile.append("metadata", metadata); cases.push([">25 MB", largeFile, "ASSET_FILE_INVALID"]);
    const malformed = new FormData(); malformed.append("image", imagePart(), "image.png"); malformed.append("metadata", "{not-json"); cases.push(["malformed metadata JSON", malformed, "INVALID_REQUEST"]);
    cases.push(["non-multipart", JSON.stringify({ metadata }), "ASSET_FILE_INVALID"]);

    for (const [name, body, code] of cases) {
      const response = await fetch(url, { method: "POST", body, headers: name === "non-multipart" ? { "content-type": "application/json" } : undefined });
      expect(response.status, name).toBe(400);
      const error = await response.json() as { code: string; message: string };
      expect(error.code, name).toBe(code);
      expect(error.message, name).not.toContain(root);
    }
  }, 30_000);
});
