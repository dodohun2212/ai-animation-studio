import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "./assets.repository.js";
import { AssetsService } from "./assets.service.js";

const roots: string[] = [];
const makeRoot = async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-backend-")); roots.push(root); return root; };
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const metadata = { assetType: "background" as const, displayName: "밤 도시", tags: ["야경"] };
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("LocalAssetsRepository", () => {
  it("persists, reloads, deduplicates, updates and removes metadata without deleting bytes", async () => {
    const root = await makeRoot();
    const first = new LocalAssetsRepository(root);
    const created = await first.create({ buffer: image, originalname: "도시_야경.png", mimetype: "image/png" }, metadata);
    const same = await first.create({ buffer: image, originalname: "복사.png", mimetype: "image/png" }, { ...metadata, displayName: "복사", approved: true });
    expect(same.asset_id).toBe(created.asset_id);
    expect(same).toMatchObject({ status: "manual", approved: true, source_project_id: "_asset_library_manual" });
    const second = new LocalAssetsRepository(root);
    expect((await second.get(created.asset_id)).display_name).toBe("밤 도시");
    expect(await fs.readFile(path.join(root, "asset_library", "assets.json"), "utf8")).toContain('"asset_id"');
    const bytesPath = second.resolveContentPath(created);
    expect(bytesPath).not.toBeNull();
    await second.update(created.asset_id, { displayName: "새 도시" });
    expect((await second.get(created.asset_id)).display_name).toBe("새 도시");
    await second.remove(created.asset_id);
    expect(await fs.readFile(bytesPath!)).toEqual(image);
  });

  it("blocks deletion when a project mapping uses the asset", async () => {
    const root = await makeRoot();
    const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "city.png" }, metadata);
    const project = path.join(root, "projects", "p1");
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "asset_mappings.json"), JSON.stringify([{ asset_id: asset.asset_id }]), "utf8");
    await expect(repository.remove(asset.asset_id)).rejects.toMatchObject({ response: { code: "ASSET_IN_USE" } });
    expect(await repository.usageProjects(asset.asset_id)).toEqual(["p1"]);
  });

  it("does not rewrite a legacy index during reads", async () => {
    const root = await makeRoot();
    const directory = path.join(root, "asset_library");
    await fs.mkdir(directory, { recursive: true });
    const raw = JSON.stringify([{ asset_id: "ASSET-BG-OLD", asset_type: "background", display_name: "old", stored_path: "missing.png", original_filename: "missing.png", content_sha256: "a".repeat(64), versions: [{ version: 1, stored_path: "missing.png", content_sha256: "a".repeat(64), created_at: "2020-01-01T00:00:00+00:00", notes: "" }] }]);
    await fs.writeFile(path.join(directory, "assets.json"), raw, "utf8");
    const repository = new LocalAssetsRepository(root);
    expect((await repository.list())[0]!.enabled).toBe(true);
    expect(await fs.readFile(path.join(directory, "assets.json"), "utf8")).toBe(raw);
  });

  it("returns safe errors for malformed JSON and unknown fields", async () => {
    const root = await makeRoot(); const directory = path.join(root, "asset_library"); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "assets.json"), "{", "utf8");
    await expect(new LocalAssetsRepository(root).list()).rejects.toMatchObject({ response: { code: "ASSET_JSON_MALFORMED" } });
    await fs.writeFile(path.join(directory, "assets.json"), JSON.stringify([{ unknown: true }]), "utf8");
    await expect(new LocalAssetsRepository(root).list()).rejects.toMatchObject({ response: { code: "ASSET_DATA_INVALID" } });
  });

  it("serializes read-modify-write across repository instances", async () => {
    const root = await makeRoot();
    const firstImage = Buffer.from(image);
    const secondImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const first = new LocalAssetsRepository(root); const second = new LocalAssetsRepository(path.join(root, ".", ""));
    await Promise.all([
      first.create({ buffer: firstImage, originalname: "첫번째.png", mimetype: "image/png" }, metadata),
      second.create({ buffer: secondImage, originalname: "두번째.png", mimetype: "image/png" }, { ...metadata, displayName: "두 번째" }),
    ]);
    expect(await new LocalAssetsRepository(root).list()).toHaveLength(2);
    await expect(fs.access(path.join(root, "asset_library", ".assets-json.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("normalizes non-character to character before save and restart", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "인물.png", mimetype: "image/png" }, metadata);
    const updated = await repository.update(asset.asset_id, { assetType: "character", faceBaseline: true });
    expect(updated.reference_images.map((item) => item.role)).toEqual(["thumbnail", "front"]);
    expect(await new LocalAssetsRepository(root).get(asset.asset_id)).toEqual(updated);
  });

  it("rejects minimal-step mutation for folders and parented children", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const child = await repository.create({ buffer: image, originalname: "하위.png", mimetype: "image/png" }, metadata);
    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    records[0]!.parent_folder_id = "FOLDER-ROOT";
    records.push({
      asset_id: "FOLDER-ROOT", asset_type: "background", display_name: "배경 폴더", description: "", stored_path: "",
      original_filename: "", content_sha256: "", tags: [], aliases: [], enabled: true, approved: false, face_baseline: false,
      character_key: null, version: 1, versions: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      notes: "", legacy_asset_ids: [], status: "manual", source_project_id: "", source_scene_number: null,
      reference_images: [], reference_roles: [], is_folder: true, parent_folder_id: "", child_asset_ids: [child.asset_id],
      thumbnail_asset_id: child.asset_id, role: "", sort_order: 0,
    });
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
    for (const id of [child.asset_id, "FOLDER-ROOT"]) {
      await expect(repository.update(id, { displayName: "변경 금지" })).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
      await expect(repository.remove(id)).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
    }
  });

  it("never serves a legacy path outside the real learning-data root", async () => {
    const root = await makeRoot(); const outside = await makeRoot();
    const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "안전.png", mimetype: "image/png" }, metadata);
    const outsideFile = path.join(outside, "외부.png"); await fs.writeFile(outsideFile, image);
    asset.stored_path = outsideFile; asset.versions[0]!.stored_path = outsideFile;
    expect(repository.resolveContentPath(asset)).toBeNull();
    expect(repository.resolveContentPath({ ...asset, stored_path: outside, versions: [{ ...asset.versions[0]!, stored_path: outside }] })).toBeNull();
  });

  it("conservatively recovers a stale cross-process lock", async () => {
    const root = await makeRoot(); const lockDirectory = path.join(root, "asset_library"); await fs.mkdir(lockDirectory, { recursive: true });
    const lockPath = path.join(lockDirectory, ".assets-json.lock"); await fs.writeFile(lockPath, "stale-owner", "ascii");
    const old = new Date(Date.now() - 61_000); await fs.utimes(lockPath, old, old);
    const created = await new LocalAssetsRepository(root).create({ buffer: image, originalname: "복구.png", mimetype: "image/png" }, metadata);
    expect(created.display_name).toBe("밤 도시");
    await expect(fs.access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("round-trips genuine Korean legacy JSON unchanged across restart", async () => {
    const root = await makeRoot(); const directory = path.join(root, "asset_library"); await fs.mkdir(directory, { recursive: true });
    const raw = `[
  {
    "asset_id": "ASSET-BG-KOREAN",
    "asset_type": "background",
    "display_name": "한강의 밤 풍경",
    "description": "비가 내린 뒤 반짝이는 서울 거리",
    "stored_path": "서울_야경.png",
    "original_filename": "원본_서울_야경.png",
    "content_sha256": "${"a".repeat(64)}",
    "tags": ["야경", "비 오는 거리"],
    "aliases": ["서울 배경"],
    "versions": [{"version": 1, "stored_path": "서울_야경.png", "content_sha256": "${"a".repeat(64)}", "created_at": "2026-08-22T00:00:00+00:00", "notes": "한글 메모"}]
  }
]`;
    const indexPath = path.join(directory, "assets.json"); await fs.writeFile(indexPath, raw, "utf8");
    expect((await new LocalAssetsRepository(root).list())[0]).toMatchObject({ display_name: "한강의 밤 풍경", tags: ["야경", "비 오는 거리"] });
    expect((await new LocalAssetsRepository(root).list())[0]!.description).toBe("비가 내린 뒤 반짝이는 서울 거리");
    expect(await fs.readFile(indexPath, "utf8")).toBe(raw);
  });

  it("synthesizes omitted legacy versions in memory without rewriting raw JSON", async () => {
    const root = await makeRoot(); const directory = path.join(root, "asset_library"); await fs.mkdir(directory, { recursive: true });
    const digest = "c".repeat(64);
    const raw = `[{"asset_id":"ASSET-BG-NOVERSIONS","asset_type":"background","display_name":"버전 기록 없는 배경","description":"초기 Python 인덱스","stored_path":"legacy.png","original_filename":"레거시_배경.png","content_sha256":"${digest}","created_at":"2024-01-02T03:04:05+00:00","updated_at":"2024-01-02T03:04:05+00:00"}]`;
    const indexPath = path.join(directory, "assets.json"); await fs.writeFile(indexPath, raw, "utf8");
    const first = (await new LocalAssetsRepository(root).list())[0]!;
    expect(first.versions).toEqual([{ version: 1, stored_path: "legacy.png", content_sha256: digest, created_at: "2024-01-02T03:04:05+00:00", notes: "" }]);
    const reopened = (await new LocalAssetsRepository(root).get("ASSET-BG-NOVERSIONS"));
    expect(reopened).toEqual(first);
    const api = await new AssetsService(new LocalAssetsRepository(root)).get("ASSET-BG-NOVERSIONS");
    expect(api.asset).toMatchObject({ assetId: "ASSET-BG-NOVERSIONS", displayName: "버전 기록 없는 배경", version: 1 });
    expect(api.asset.versions).toEqual([{ version: 1, contentSha256: digest, createdAt: "2024-01-02T03:04:05+00:00", notes: "" }]);
    expect(JSON.stringify(api)).not.toContain("stored_path");
    expect(await fs.readFile(indexPath, "utf8")).toBe(raw);
  });
});
