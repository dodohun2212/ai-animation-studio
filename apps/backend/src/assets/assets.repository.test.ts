import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "./assets.repository.js";
import { AssetsService } from "./assets.service.js";

const roots: string[] = [];
const makeRoot = async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-backend-")); roots.push(root); return root; };
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const secondImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
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
    // notes is outside both the folder's (displayName/description/tags) and the child's (role/description)
    // allowed sets, so it stays a clean "rejected either way" probe now that each has its own whitelist.
    for (const id of [child.asset_id, "FOLDER-ROOT"]) {
      await expect(repository.update(id, { notes: "변경 금지" })).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
      await expect(repository.remove(id)).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
    }
  });

  it("allows only role and description for a parented (folder-child) asset, and only displayName/description/tags for the folder itself", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const child = await repository.create({ buffer: image, originalname: "하위.png", mimetype: "image/png" }, metadata);
    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    records[0]!.parent_folder_id = "FOLDER-ROOT-2";
    records.push({
      asset_id: "FOLDER-ROOT-2", asset_type: "background", display_name: "배경 폴더", description: "", stored_path: "",
      original_filename: "", content_sha256: "", tags: [], aliases: [], enabled: true, approved: false, face_baseline: false,
      character_key: null, version: 1, versions: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      notes: "", legacy_asset_ids: [], status: "manual", source_project_id: "", source_scene_number: null,
      reference_images: [], reference_roles: [], is_folder: true, parent_folder_id: "", child_asset_ids: [child.asset_id],
      thumbnail_asset_id: child.asset_id, role: "", sort_order: 0,
    });
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");

    const roleUpdated = await repository.update(child.asset_id, { role: "front" });
    expect(roleUpdated.role).toBe("front");
    const descriptionUpdated = await repository.update(child.asset_id, { description: "정면 참고 이미지" });
    expect(descriptionUpdated.description).toBe("정면 참고 이미지");

    await expect(repository.update(child.asset_id, { role: "front", tags: ["x"] })).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });

    // The folder itself: displayName/description/tags are allowed (description in particular feeds every
    // child image's generation prompt), but a field with no meaning for a folder (role, asset type, ...) is not.
    await expect(repository.update("FOLDER-ROOT-2", { role: "front" })).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
    await expect(repository.update("FOLDER-ROOT-2", { description: "폴더 설명", role: "front" })).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
    const folderUpdated = await repository.update("FOLDER-ROOT-2", { displayName: "새 배경 폴더", description: "폴더 설명", tags: ["a", "b"] });
    expect(folderUpdated).toMatchObject({ display_name: "새 배경 폴더", description: "폴더 설명", tags: ["a", "b"] });
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

  it("never resolves an unsafe version path or a link that escapes learning_data", async () => {
    const root = await makeRoot(); const outside = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "version.png", mimetype: "image/png" }, metadata);
    const outsideFile = path.join(outside, "outside.png"); await fs.writeFile(outsideFile, image);
    asset.versions[0]!.stored_path = outsideFile;
    expect(repository.resolveVersionContentPath(asset, 1)).toBeNull();
    const linked = path.join(root, "linked-outside");
    await fs.symlink(outside, linked, "junction");
    asset.versions[0]!.stored_path = path.join(linked, "outside.png");
    expect(repository.resolveVersionContentPath(asset, 1)).toBeNull();
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

  it("adds a new version, rejects a duplicate version and rejects a folder", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "city.png", mimetype: "image/png" }, metadata);
    const updated = await repository.addVersion(asset.asset_id, { buffer: secondImage, originalname: "city-v2.png", mimetype: "image/png" }, "재촬영");
    expect(updated.version).toBe(2);
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[1]).toMatchObject({ version: 2, notes: "재촬영" });
    expect(updated.content_sha256).not.toBe(asset.content_sha256);
    expect(await new LocalAssetsRepository(root).get(asset.asset_id)).toEqual(updated);
    await expect(repository.addVersion(asset.asset_id, { buffer: secondImage, originalname: "again.png", mimetype: "image/png" }, ""))
      .rejects.toMatchObject({ response: { code: "ASSET_VERSION_DUPLICATE" } });
    const folder = await repository.create({ buffer: image, originalname: "폴더용.png" }, metadata);
    await repository.update(folder.asset_id, { assetType: "background" });
    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    const record = records.find((item) => item.asset_id === folder.asset_id)!;
    record.is_folder = true; record.stored_path = ""; record.content_sha256 = ""; record.versions = []; record.child_asset_ids = []; record.thumbnail_asset_id = "";
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
    await expect(repository.addVersion(folder.asset_id, { buffer: secondImage, originalname: "x.png" }, ""))
      .rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
  });

  it("relinks an Asset to replacement bytes while preserving its identity and version count", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "city.png", mimetype: "image/png" }, metadata);
    const relinked = await repository.relink(asset.asset_id, { buffer: secondImage, originalname: "replacement.png", mimetype: "image/png" });
    expect(relinked.asset_id).toBe(asset.asset_id);
    expect(relinked.version).toBe(1);
    expect(relinked.versions).toHaveLength(1);
    expect(relinked.content_sha256).not.toBe(asset.content_sha256);
    expect(relinked.status).toBe("manual");
    expect(await fs.readFile(repository.resolveContentPath(relinked)!)).toEqual(secondImage);
    expect(await new LocalAssetsRepository(root).get(asset.asset_id)).toEqual(relinked);
  });

  it("audits missing, damaged and healthy indexed files without changing metadata", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const healthy = await repository.create({ buffer: image, originalname: "healthy.png", mimetype: "image/png" }, metadata);
    const missing = await repository.create({ buffer: secondImage, originalname: "missing.png", mimetype: "image/png" }, { ...metadata, displayName: "사라진 배경" });
    await fs.unlink(repository.resolveContentPath(missing)!);
    const thirdImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DwnwGMgRQAH+4D/dJQfRoAAAAASUVORK5CYII=", "base64");
    const damaged = await repository.create({ buffer: thirdImage, originalname: "damaged.png", mimetype: "image/png" }, { ...metadata, displayName: "손상된 배경" });
    await fs.truncate(repository.resolveContentPath(damaged)!, 20);
    const entries = await repository.auditFiles();
    expect(entries.find((entry) => entry.assetId === healthy.asset_id)).toMatchObject({ classification: "healthy", sourceKind: "manual", message: "" });
    expect(entries.find((entry) => entry.assetId === missing.asset_id)).toMatchObject({ classification: "missing", sourceKind: "manual" });
    expect(entries.find((entry) => entry.assetId === damaged.asset_id)).toMatchObject({ classification: "damaged", sourceKind: "manual" });
    expect(await new LocalAssetsRepository(root).get(healthy.asset_id)).toEqual(healthy);
  });

  it("deletes an unused manual Asset's owned file unless another Asset still shares it, and blocks in-use or project-owned files", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "city.png", mimetype: "image/png" }, metadata);
    const project = path.join(root, "projects", "p1"); await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "asset_mappings.json"), JSON.stringify([{ asset_id: asset.asset_id }]), "utf8");
    await expect(repository.removeOwnedFile(asset.asset_id)).rejects.toMatchObject({ response: { code: "ASSET_IN_USE" } });
    await fs.rm(path.join(project, "asset_mappings.json"));
    const contentPath = repository.resolveContentPath(asset)!;
    await repository.removeOwnedFile(asset.asset_id);
    await expect(repository.get(asset.asset_id)).rejects.toMatchObject({ response: { code: "ASSET_NOT_FOUND" } });
    await expect(fs.access(contentPath)).rejects.toMatchObject({ code: "ENOENT" });
    const generated = await repository.create({ buffer: secondImage, originalname: "generated.png", mimetype: "image/png" }, { ...metadata, displayName: "생성됨" });
    const generatedIndex = path.join(root, "asset_library", "assets.json");
    const generatedRecords = JSON.parse(await fs.readFile(generatedIndex, "utf8")) as Array<Record<string, unknown>>;
    generatedRecords.find((item) => item.asset_id === generated.asset_id)!.source_project_id = "proj-1";
    await fs.writeFile(generatedIndex, JSON.stringify(generatedRecords), "utf8");
    await expect(repository.removeOwnedFile(generated.asset_id)).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
  });

  it("keeps a manual Asset's shared file on disk when another Asset still points at the same bytes", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const first = await repository.create({ buffer: image, originalname: "a.png", mimetype: "image/png" }, metadata);
    const second = await repository.create({ buffer: image, originalname: "b.png", mimetype: "image/png" }, { ...metadata, displayName: "동일 사본" });
    expect(second.asset_id).toBe(first.asset_id);
    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    records.push({ ...records[0]!, asset_id: "ASSET-BG-CLONE" });
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
    const contentPath = repository.resolveContentPath(first)!;
    await repository.removeOwnedFile(first.asset_id);
    await expect(fs.access(contentPath)).resolves.toBeUndefined();
  });

  it("invalidates a dependent short-project mapping review and workflow state only for a matching version policy", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "c.png", mimetype: "image/png" }, metadata);
    const project = path.join(root, "projects", "p1"); await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "asset_mappings.json"), JSON.stringify([{ asset_id: asset.asset_id, version_policy: "pinned_version" }]), "utf8");
    await fs.writeFile(path.join(project, "asset_mapping_review.json"), JSON.stringify({
      project_id: "p1", mapping_revision: 1, script_revision: 1, script_fingerprint: "a".repeat(64), status: "approved",
      approved_at: "2026-01-01T00:00:00Z", approved_by: "user", text_only_confirmed: false, legacy_confirmed: false, reviewed_scenes: [1],
    }), "utf8");
    await fs.writeFile(path.join(project, "project.json"), JSON.stringify({ project_id: "p1", workflow_state: "ASSET_MAPPING_APPROVED" }), "utf8");
    await repository.addVersion(asset.asset_id, { buffer: secondImage, originalname: "c2.png", mimetype: "image/png" }, "");
    const reviewAfterFollowLatest = JSON.parse(await fs.readFile(path.join(project, "asset_mapping_review.json"), "utf8"));
    expect(reviewAfterFollowLatest).toMatchObject({ status: "approved", mapping_revision: 1 });
    const projectAfterFollowLatest = JSON.parse(await fs.readFile(path.join(project, "project.json"), "utf8"));
    expect(projectAfterFollowLatest.workflow_state).toBe("ASSET_MAPPING_APPROVED");
    await repository.relink(asset.asset_id, { buffer: image, originalname: "c3.png", mimetype: "image/png" });
    const reviewAfterRelink = JSON.parse(await fs.readFile(path.join(project, "asset_mapping_review.json"), "utf8"));
    expect(reviewAfterRelink).toMatchObject({ status: "waiting", approved_at: "", approved_by: "", mapping_revision: 2 });
    const projectAfterRelink = JSON.parse(await fs.readFile(path.join(project, "project.json"), "utf8"));
    expect(projectAfterRelink.workflow_state).toBe("WAITING_FOR_ASSET_MAPPING_REVIEW");
  });

  it("invalidates a dependent Episode mapping review and state when a follow_latest candidate's Asset gains a new version", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "d.png", mimetype: "image/png" }, metadata);
    const episode = path.join(root, "projects", "p2", "long_story", "Episode01"); await fs.mkdir(episode, { recursive: true });
    // The shape the app actually writes: mappings live in their own file, and the review record has no
    // `candidates`. Written by hand as `candidates` this test passed while the cascade it guards did nothing —
    // the Episode's review was the one file the mapping teardown left this function still reading the old way.
    await fs.writeFile(path.join(episode, "asset_mapping_review.json"), JSON.stringify({
      project_id: "p2", mapping_revision: 1, script_revision: 1, script_fingerprint: "b".repeat(64), status: "approved",
      text_only_confirmed: false, legacy_confirmed: false, reviewed_scenes: [1], approved_at: "2026-01-01T00:00:00Z", approved_by: "user",
    }), "utf8");
    await fs.writeFile(path.join(episode, "asset_mappings.json"), JSON.stringify([
      { mapping_id: "MAP-1", project_id: "p2", asset_id: asset.asset_id, enabled: true, usage_role: "character", scene_scope: { mode: "all" }, assignment_source: "manual", confidence: null, match_reason: "manual_assignment", status: "confirmed", user_confirmed: true, version_policy: "follow_latest", pinned_version: null, candidate_only: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [] },
    ]), "utf8");
    await fs.writeFile(path.join(episode, "project.json"), JSON.stringify({ number: 1, state: "asset_mapping_approved" }), "utf8");
    await repository.addVersion(asset.asset_id, { buffer: secondImage, originalname: "d2.png", mimetype: "image/png" }, "");
    const review = JSON.parse(await fs.readFile(path.join(episode, "asset_mapping_review.json"), "utf8"));
    expect(review).toMatchObject({ status: "waiting", approved_at: "", mapping_revision: 2 });
    const episodeProject = JSON.parse(await fs.readFile(path.join(episode, "project.json"), "utf8"));
    expect(episodeProject.state).toBe("waiting_for_asset_mapping_review");
  });

  it("imports a legacy Reference into the Library, tagging its legacy ID, and dedupes by content on a second import", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const legacyDirectory = path.join(root, "projects", "legacy_project", "reference_assets");
    await fs.mkdir(legacyDirectory, { recursive: true });
    const legacyFile = path.join(legacyDirectory, "RA-000000000001.png");
    await fs.writeFile(legacyFile, image);
    const asset = await repository.importLegacyReference(legacyFile, {
      assetType: "character", displayName: "레거시 캐릭터", approved: true, faceBaseline: true, characterKey: "hero", notes: "이전됨", legacyAssetId: "RA-000000000001",
    });
    expect(asset).toMatchObject({ display_name: "레거시 캐릭터", approved: true, face_baseline: true, character_key: "hero", status: "manual", source_project_id: "_asset_library_manual", legacy_asset_ids: ["RA-000000000001"] });
    expect(await new LocalAssetsRepository(root).get(asset.asset_id)).toEqual(asset);

    const secondLegacyFile = path.join(legacyDirectory, "RA-000000000002.png");
    await fs.writeFile(secondLegacyFile, image);
    const deduped = await repository.importLegacyReference(secondLegacyFile, {
      assetType: "character", displayName: "다른 이름", legacyAssetId: "RA-000000000002",
    });
    expect(deduped.asset_id).toBe(asset.asset_id);
    expect(deduped.legacy_asset_ids).toEqual(["RA-000000000001", "RA-000000000002"]);
    expect((await repository.list())).toHaveLength(1);
  });

  async function makeFolderFixture(root: string, repository: LocalAssetsRepository) {
    const firstChild = await repository.create({ buffer: image, originalname: "first.png", mimetype: "image/png" }, metadata);
    const secondChild = await repository.create({ buffer: secondImage, originalname: "second.png", mimetype: "image/png" }, { ...metadata, displayName: "두 번째" });
    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    const folderId = "FOLDER-DELETE-TEST";
    for (const record of records) if (record.asset_id === firstChild.asset_id || record.asset_id === secondChild.asset_id) record.parent_folder_id = folderId;
    records.push({
      asset_id: folderId, asset_type: "background", display_name: "삭제 테스트 폴더", description: "", stored_path: "",
      original_filename: "", content_sha256: "", tags: [], aliases: [], enabled: true, approved: false, face_baseline: false,
      character_key: null, version: 1, versions: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      notes: "", legacy_asset_ids: [], status: "manual", source_project_id: "", source_scene_number: null,
      reference_images: [], reference_roles: [], is_folder: true, parent_folder_id: "",
      child_asset_ids: [firstChild.asset_id, secondChild.asset_id], thumbnail_asset_id: firstChild.asset_id, role: "", sort_order: 0,
    });
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
    return { folderId, firstChild, secondChild };
  }

  it("deletes only Folder metadata by default, leaving children unparented and their files intact", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const { folderId, firstChild, secondChild } = await makeFolderFixture(root, repository);
    const result = await repository.removeFolder(folderId);
    expect(result).toEqual({ removedChildAssetIds: [], deletedFiles: 0 });
    const remaining = await new LocalAssetsRepository(root).list();
    expect(remaining.map((item) => item.asset_id).sort()).toEqual([firstChild.asset_id, secondChild.asset_id].sort());
    expect(remaining.every((item) => item.parent_folder_id === "")).toBe(true);
    expect(await fs.readFile(repository.resolveContentPath(firstChild)!)).toEqual(image);
  });

  it("removes child indexes too when removeChildIndexes is requested, but keeps their manual files", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const { folderId, firstChild, secondChild } = await makeFolderFixture(root, repository);
    const contentPath = repository.resolveContentPath(firstChild)!;
    const result = await repository.removeFolder(folderId, { removeChildIndexes: true });
    expect(result.removedChildAssetIds.sort()).toEqual([firstChild.asset_id, secondChild.asset_id].sort());
    expect(result.deletedFiles).toBe(0);
    expect(await new LocalAssetsRepository(root).list()).toEqual([]);
    await expect(fs.access(contentPath)).resolves.toBeUndefined();
  });

  it("deletes manual children's owned files when deleteManualFiles is requested, sharing bytes are preserved", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const { folderId, firstChild, secondChild } = await makeFolderFixture(root, repository);
    const firstPath = repository.resolveContentPath(firstChild)!; const secondPath = repository.resolveContentPath(secondChild)!;
    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    records.push({ ...records.find((item) => item.asset_id === firstChild.asset_id), asset_id: "ASSET-BG-CLONE", parent_folder_id: "" });
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");

    const result = await repository.removeFolder(folderId, { deleteManualFiles: true });
    expect(result.removedChildAssetIds.sort()).toEqual([firstChild.asset_id, secondChild.asset_id].sort());
    expect(result.deletedFiles).toBe(1); // only the second child's unshared file is actually deleted
    await expect(fs.access(firstPath)).resolves.toBeUndefined(); // still shared by ASSET-BG-CLONE
    await expect(fs.access(secondPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await new LocalAssetsRepository(root).list()).map((item) => item.asset_id)).toEqual(["ASSET-BG-CLONE"]);
  });

  it("blocks Folder deletion when the Folder itself is used by a project", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const { folderId } = await makeFolderFixture(root, repository);
    const project = path.join(root, "projects", "p1"); await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "asset_mappings.json"), JSON.stringify([{ asset_id: folderId }]), "utf8");
    await expect(repository.removeFolder(folderId, { removeChildIndexes: true })).rejects.toMatchObject({ response: { code: "ASSET_IN_USE" } });
  });

  it("blocks removeChildIndexes when a child is used by a project, and blocks deleteManualFiles for a non-manual child", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const { folderId, firstChild } = await makeFolderFixture(root, repository);
    const project = path.join(root, "projects", "p1"); await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "asset_mappings.json"), JSON.stringify([{ asset_id: firstChild.asset_id }]), "utf8");
    await expect(repository.removeFolder(folderId, { removeChildIndexes: true })).rejects.toMatchObject({ response: { code: "ASSET_IN_USE" } });
    await fs.rm(path.join(project, "asset_mappings.json"));

    const indexPath = path.join(root, "asset_library", "assets.json");
    const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    records.find((item) => item.asset_id === firstChild.asset_id)!.source_project_id = "some_project";
    await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
    await expect(repository.removeFolder(folderId, { deleteManualFiles: true })).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
  });

  it("rejects Folder deletion for a non-folder Asset", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const asset = await repository.create({ buffer: image, originalname: "not-a-folder.png" }, metadata);
    await expect(repository.removeFolder(asset.asset_id)).rejects.toMatchObject({ response: { code: "ASSET_MUTATION_UNSUPPORTED" } });
  });

  it("hides an archived project's generated Assets and shows them again after a restore", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const projectId = "archived_project";
    const imagesDir = path.join(root, "projects", projectId, "images");
    await fs.mkdir(imagesDir, { recursive: true });
    for (const number of [1, 2]) await fs.writeFile(path.join(imagesDir, `scene${number}.png`), image);
    await repository.indexGeneratedProjectImages({ sourceProjectId: projectId, imagesDirectory: imagesDir, kind: "short project" }, "topic", ["one", "two"]);
    const manual = await repository.create({ buffer: secondImage, originalname: "mine.png" }, metadata);

    expect((await repository.listExcludingArchivedProjects()).length).toBe(4);

    const archived = path.join(root, "projects", ".archive");
    await fs.mkdir(archived, { recursive: true });
    await fs.rename(path.join(root, "projects", projectId), path.join(archived, projectId));

    // The Folder goes with its children: leaving either behind is the dead-picture Folder this hides.
    const visible = await repository.listExcludingArchivedProjects();
    expect(visible.map((asset) => asset.asset_id)).toEqual([manual.asset_id]);
    expect((await repository.list()).length).toBe(4);

    await fs.rename(path.join(archived, projectId), path.join(root, "projects", projectId));
    expect((await repository.listExcludingArchivedProjects()).length).toBe(4);
  });

  it("hides an archived long project's Episode Assets, which name the project and the Episode", async () => {
    const root = await makeRoot(); const directory = path.join(root, "asset_library");
    await fs.mkdir(directory, { recursive: true });
    const episodeAsset = {
      asset_id: "ASSET-GENERAL-EPISODE", asset_type: "general_reference", display_name: "12/Episode01 Scene 1",
      stored_path: path.join(root, "projects", "12", "long_story", "Episode01", "images", "scene1.png"),
      original_filename: "scene1.png", content_sha256: "b".repeat(64),
      notes: "Automatically indexed project image", status: "generated",
      source_project_id: "12/Episode01", source_scene_number: 1,
    };
    await fs.writeFile(path.join(directory, "assets.json"), JSON.stringify([episodeAsset]), "utf8");
    const repository = new LocalAssetsRepository(root);
    expect((await repository.listExcludingArchivedProjects()).length).toBe(1);

    await fs.mkdir(path.join(root, "projects", ".archive", "12"), { recursive: true });
    expect(await repository.listExcludingArchivedProjects()).toEqual([]);
  });

  it("drops only auto-indexed records when a project is deleted for good, repairing the Folders that referenced them", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const projectId = "doomed_project";
    const imagesDir = path.join(root, "projects", projectId, "images");
    await fs.mkdir(imagesDir, { recursive: true });
    for (const number of [1, 2]) await fs.writeFile(path.join(imagesDir, `scene${number}.png`), image);
    await repository.indexGeneratedProjectImages({ sourceProjectId: projectId, imagesDirectory: imagesDir, kind: "short project" }, "topic", ["one", "two"]);
    const manual = await repository.create({ buffer: secondImage, originalname: "mine.png" }, metadata);
    const generated = (await repository.list()).filter((asset) => !asset.is_folder && asset.source_project_id === projectId);
    // A generated image the user filed under a Folder of their own: that Folder outlives the project and must
    // not be left pointing at a record that is gone.
    const ownFolder = await repository.createFolder({ assetType: "general_reference", displayName: "내 폴더" });
    await repository.setParentFolder(generated[0]!.asset_id, ownFolder.asset_id);
    expect((await repository.get(ownFolder.asset_id)).thumbnail_asset_id).toBe(generated[0]!.asset_id);

    const removed = await repository.removeGeneratedProjectAssets(projectId);

    expect(removed.length).toBe(3);
    const remaining = await repository.list();
    expect(remaining.map((asset) => asset.asset_id).sort()).toEqual([manual.asset_id, ownFolder.asset_id].sort());
    const reloaded = remaining.find((asset) => asset.asset_id === ownFolder.asset_id)!;
    expect(reloaded.child_asset_ids).toEqual([]);
    expect(reloaded.thumbnail_asset_id).toBe("");
    expect(await repository.removeGeneratedProjectAssets(projectId)).toEqual([]);
    // The bytes belong to the project directory, not to the Library: deleting records never touches files.
    expect(await fs.readFile(path.join(imagesDir, "scene1.png"))).toEqual(image);
  });

  it("indexes exactly the project's actual generated scene count (not a fixed six)", async () => {
    const root = await makeRoot(); const repository = new LocalAssetsRepository(root);
    const projectId = "four_scene_project";
    const imagesDir = path.join(root, "projects", projectId, "images");
    await fs.mkdir(imagesDir, { recursive: true });
    for (const number of [1, 2, 3, 4]) await fs.writeFile(path.join(imagesDir, `scene${number}.png`), image);

    await repository.indexGeneratedProjectImages({ sourceProjectId: projectId, imagesDirectory: imagesDir, kind: "short project" }, "topic", ["one", "two", "three", "four"]);

    const all = await repository.list();
    const children = all.filter((item) => !item.is_folder && item.source_project_id === projectId).sort((a, b) => a.source_scene_number! - b.source_scene_number!);
    expect(children.map((item) => item.source_scene_number)).toEqual([1, 2, 3, 4]);
    const folder = all.find((item) => item.is_folder && item.source_project_id === projectId)!;
    expect(folder.child_asset_ids).toEqual(children.map((item) => item.asset_id));
  });
});
