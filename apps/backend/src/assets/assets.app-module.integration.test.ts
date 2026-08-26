import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const secondPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let app: INestApplication | undefined;
let root: string | undefined;
let previousRoot: string | undefined;
let previousSettingsRoot: string | undefined;

afterEach(async () => {
  await app?.close(); app = undefined;
  if (previousRoot === undefined) delete process.env.LEARNING_DATA_ROOT;
  else process.env.LEARNING_DATA_ROOT = previousRoot;
  previousRoot = undefined;
  if (previousSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT;
  else process.env.PROVIDER_SETTINGS_ROOT = previousSettingsRoot;
  previousSettingsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

describe.sequential("real AppModule Asset HTTP smoke", () => {
  it("uses module DI for empty/list/import/detail/content and rejects encoded separators", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-app-module-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT;
    process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    expect(await (await fetch(`${base}/assets`)).json()).toEqual({ assets: [] });
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "검증고양이.png");
    form.append("metadata", JSON.stringify({ assetType: "character", displayName: "실제 AppModule 고양이" }));
    const createdResponse = await fetch(`${base}/assets`, { method: "POST", body: form });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { asset: { assetId: string; contentUrl: string; originalFilename: string; referenceImages: Array<{ originalFilename: string }> } };
    expect(created.asset.originalFilename).toBe("검증고양이.png");
    expect(created.asset.referenceImages.map((item) => item.originalFilename)).toEqual(["검증고양이.png", "검증고양이.png"]);

    const detail = await (await fetch(`${base}/assets/${created.asset.assetId}`)).json() as { asset: { displayName: string; originalFilename: string; referenceImages: Array<{ originalFilename: string }> }; ownership: string };
    expect(detail).toMatchObject({ asset: { displayName: "실제 AppModule 고양이", originalFilename: "검증고양이.png" }, ownership: "library_manual" });
    expect(detail.asset.referenceImages.map((item) => item.originalFilename)).toEqual(["검증고양이.png", "검증고양이.png"]);
    const content = await fetch(`${base}${created.asset.contentUrl}`);
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(png);

    const unsafe = await fetch(`${base}/assets/ASSET-BG-%2FESCAPE`);
    expect(unsafe.status).toBe(400);
    expect(await unsafe.json()).toMatchObject({ code: "UNSAFE_ASSET_ID" });
    const rawIndex = await fs.readFile(path.join(root, "asset_library", "assets.json"), "utf8");
    expect(rawIndex).toContain('"original_filename": "검증고양이.png"');
    expect(rawIndex).not.toContain("ê²");

    await app.close(); app = undefined;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const restartedBase = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const reopened = await (await fetch(`${restartedBase}/assets/${created.asset.assetId}`)).json() as typeof detail;
    expect(reopened.asset.originalFilename).toBe("검증고양이.png");
    expect(reopened.asset.referenceImages.map((item) => item.originalFilename)).toEqual(["검증고양이.png", "검증고양이.png"]);
    expect((await fs.readdir(path.join(root, "asset_library"))).filter((name) => name.endsWith(".tmp") || name === ".assets-json.lock")).toEqual([]);
  });

  it("serves version add, relink, audit and owned-file deletion over real HTTP without a Provider call", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-app-module-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT;
    process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    const importForm = new FormData();
    importForm.append("image", new Blob([png], { type: "image/png" }), "one.png");
    importForm.append("metadata", JSON.stringify({ assetType: "background", displayName: "Version target" }));
    const created = await (await fetch(`${base}/assets`, { method: "POST", body: importForm })).json() as { asset: { assetId: string } };

    const versionForm = new FormData();
    versionForm.append("image", new Blob([secondPng], { type: "image/png" }), "two.png");
    versionForm.append("notes", "재촬영");
    const versionResponse = await fetch(`${base}/assets/${created.asset.assetId}/versions`, { method: "POST", body: versionForm });
    expect(versionResponse.status).toBe(201);
    const versioned = await versionResponse.json() as { asset: { version: number; versions: Array<{ version: number; notes: string }> } };
    expect(versioned.asset.version).toBe(2);
    expect(versioned.asset.versions).toMatchObject([{ version: 1 }, { version: 2, notes: "재촬영" }]);

    const relinkForm = new FormData();
    relinkForm.append("image", new Blob([png], { type: "image/png" }), "back.png");
    const relinkResponse = await fetch(`${base}/assets/${created.asset.assetId}/relink`, { method: "POST", body: relinkForm });
    expect(relinkResponse.status).toBe(201);

    const auditResponse = await fetch(`${base}/assets/audit`);
    expect(auditResponse.status).toBe(200);
    const audit = await auditResponse.json() as { entries: Array<{ assetId: string; classification: string }> };
    expect(audit.entries).toContainEqual(expect.objectContaining({ assetId: created.asset.assetId, classification: "healthy" }));

    const deleteResponse = await fetch(`${base}/assets/${created.asset.assetId}/owned-file`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ assetId: created.asset.assetId, deletedOwnedFile: true });
    expect((await fetch(`${base}/assets/${created.asset.assetId}`)).status).toBe(404);
  });

  it("deletes a Character Folder and its child indexes over real HTTP without a Provider call", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-app-module-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT;
    process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    const importForm = new FormData();
    importForm.append("image", new Blob([png], { type: "image/png" }), "front.png");
    importForm.append("metadata", JSON.stringify({ assetType: "character", displayName: "Folder child" }));
    const created = await (await fetch(`${base}/assets`, { method: "POST", body: importForm })).json() as { asset: { assetId: string } };

    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    const folderId = "FOLDER-HTTP-DELETE";
    records.find((item) => item.asset_id === created.asset.assetId)!.parent_folder_id = folderId;
    records.push({
      asset_id: folderId, asset_type: "character", display_name: "HTTP Folder", description: "", stored_path: "", original_filename: "", content_sha256: "",
      tags: [], aliases: [], enabled: true, approved: false, face_baseline: false, character_key: null, version: 1, versions: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), notes: "", legacy_asset_ids: [], status: "manual",
      source_project_id: "", source_scene_number: null, reference_images: [], reference_roles: [], is_folder: true, parent_folder_id: "",
      child_asset_ids: [created.asset.assetId], thumbnail_asset_id: created.asset.assetId, role: "", sort_order: 0,
    });
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");

    const response = await fetch(`${base}/assets/${folderId}/folder?removeChildIndexes=true`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assetId: folderId, removedChildAssetIds: [created.asset.assetId], deletedFiles: 0 });
    expect(await (await fetch(`${base}/assets`)).json()).toEqual({ assets: [] });
  });

  it("creates a Character Folder and links/unlinks a child over real HTTP, and /assets/folders never resolves as an :assetId lookup", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-app-module-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT;
    process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    const folderResponse = await fetch(`${base}/assets/folders`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetType: "character", displayName: "주인공" }),
    });
    expect(folderResponse.status).toBe(201);
    const folder = await folderResponse.json() as { asset: { assetId: string; isFolder: boolean } };
    expect(folder.asset.isFolder).toBe(true);
    // Confirms /assets/folders was routed as folder creation, not as a 404 :assetId="folders" lookup.
    expect((await fetch(`${base}/assets/${folder.asset.assetId}`)).status).toBe(200);

    const importForm = new FormData();
    importForm.append("image", new Blob([png], { type: "image/png" }), "front.png");
    importForm.append("metadata", JSON.stringify({ assetType: "general_reference", displayName: "정면" }));
    const child = await (await fetch(`${base}/assets`, { method: "POST", body: importForm })).json() as { asset: { assetId: string } };

    const linkResponse = await fetch(`${base}/assets/${child.asset.assetId}/parent-folder`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentFolderId: folder.asset.assetId }),
    });
    expect(linkResponse.status).toBe(200);
    const linked = await linkResponse.json() as { asset: { assetType: string; parentFolderId: string }; folder: { childAssetIds: string[] } };
    expect(linked.asset).toMatchObject({ assetType: "character", parentFolderId: folder.asset.assetId });
    expect(linked.folder.childAssetIds).toEqual([child.asset.assetId]);

    const unlinkResponse = await fetch(`${base}/assets/${child.asset.assetId}/parent-folder`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentFolderId: null }),
    });
    expect(unlinkResponse.status).toBe(200);
    expect((await unlinkResponse.json() as { folder: { childAssetIds: string[] } }).folder.childAssetIds).toEqual([]);
  });
});
