import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SceneNumber } from "@ai-animation-studio/shared";
import type { StoredAssetMapping } from "../mappings/mapping-storage.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { collectReferenceImages, describeReferenceMappingsForScene, referenceSourcesForScene } from "./image-reference-selection.js";

const pngA = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const pngB = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

function fixtureMapping(overrides: Partial<StoredAssetMapping>): StoredAssetMapping {
  return {
    mapping_id: "MAP-1", project_id: "p1", asset_id: "ASSET-1", enabled: true, usage_role: "style",
    scene_scope: { mode: "all" }, assignment_source: "manual", confidence: null, match_reason: "manual_assignment",
    status: "confirmed", user_confirmed: true, version_policy: "pinned_version", pinned_version: 1,
    candidate_only: false, created_at: "2026-08-25T00:00:00.000Z", updated_at: "2026-08-25T00:00:00.000Z",
    snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [],
    ...overrides,
  };
}

describe("collectReferenceImages with a Folder mapping", () => {
  it("resolves a Folder mapping to its current representative child's bytes, ignoring pinned_version", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-selection-"));
    const assets = new LocalAssetsRepository(root);
    const folder = await assets.createFolder({ assetType: "style", displayName: "City moods" });
    const first = await assets.create({ buffer: pngA, originalname: "day.png" }, { assetType: "style", displayName: "Day mood" });
    const second = await assets.create({ buffer: pngB, originalname: "night.png" }, { assetType: "style", displayName: "Night mood" });
    await assets.setParentFolder(first.asset_id, folder.asset_id);
    await assets.setParentFolder(second.asset_id, folder.asset_id);
    // The representative defaults to the first-linked child; explicitly re-pick the second one.
    await assets.updateCharacterFolderReferenceSet(folder.asset_id, { childAssetIds: [first.asset_id, second.asset_id], thumbnailAssetId: second.asset_id });

    const mapping = fixtureMapping({ asset_id: folder.asset_id, version_policy: "follow_latest", pinned_version: null });
    const collected = await collectReferenceImages(assets, [mapping], path.join(root, "projects"), 1 as SceneNumber, null);

    expect(collected.images).toHaveLength(1);
    expect(collected.images[0]).toEqual(pngB);
    expect(collected.omittedCount).toBe(0);
  });

  it("skips a Folder mapping with no representative image rather than failing the whole scene", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-selection-"));
    const assets = new LocalAssetsRepository(root);
    const emptyFolder = await assets.createFolder({ assetType: "style", displayName: "Empty" });
    const mapping = fixtureMapping({ asset_id: emptyFolder.asset_id, version_policy: "follow_latest", pinned_version: null });

    const collected = await collectReferenceImages(assets, [mapping], path.join(root, "projects"), 1 as SceneNumber, null);
    expect(collected.images).toEqual([]);
    expect(collected.omittedCount).toBe(0);
  });

  it("counts images left out once MAX_REFERENCE_IMAGES is reached, but never counts a mapping that never resolved to a file", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-selection-"));
    const assets = new LocalAssetsRepository(root);
    const created = await Promise.all(Array.from({ length: 17 }, (_, index) =>
      assets.create({ buffer: index % 2 === 0 ? pngA : pngB, originalname: `ref${index}.png` }, { assetType: "style", displayName: `Ref ${index}` })));
    const mappings = created.map((asset) => fixtureMapping({ mapping_id: `MAP-${asset.asset_id}`, asset_id: asset.asset_id, version_policy: "follow_latest", pinned_version: null }));
    // An 18th mapping whose Asset was deleted after the mapping was made — never resolves to a file, so it must
    // not count toward omittedCount even though it comes last in iteration order.
    mappings.push(fixtureMapping({ mapping_id: "MAP-missing", asset_id: "ASSET-DOES-NOT-EXIST", version_policy: "follow_latest", pinned_version: null }));

    const collected = await collectReferenceImages(assets, mappings, path.join(root, "projects"), 1 as SceneNumber, null);

    expect(collected.images).toHaveLength(16);
    expect(collected.omittedCount).toBe(1); // 17 real images - 16 sent = 1 left out; the missing-Asset mapping is not counted.
  });
});

describe("describeReferenceMappingsForScene", () => {
  it("describes a non-Folder mapping's name, usage role, and description", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-selection-"));
    const assets = new LocalAssetsRepository(root);
    const asset = await assets.create({ buffer: pngA, originalname: "hero.png" }, { assetType: "character", displayName: "이배드", description: "은발 단발, 왼쪽 눈 흉터" });
    const mapping = fixtureMapping({ asset_id: asset.asset_id, usage_role: "character" });

    const result = await describeReferenceMappingsForScene(assets, [mapping], 1);

    expect(result).toBe("References:\n- 이배드 (character)\n  설명: 은발 단발, 왼쪽 눈 흉터");
  });

  it("adds a Folder's own description plus each described child's individual one", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-selection-"));
    const assets = new LocalAssetsRepository(root);
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드", description: "근미래 방랑자" });
    const child = await assets.create({ buffer: pngA, originalname: "front.png" }, { assetType: "character", displayName: "정면", description: "정면 샷, 흉터 보임" });
    await assets.setParentFolder(child.asset_id, folder.asset_id);
    const mapping = fixtureMapping({ asset_id: folder.asset_id, usage_role: "character", version_policy: "follow_latest", pinned_version: null });

    const result = await describeReferenceMappingsForScene(assets, [mapping], 1);

    expect(result).toBe("References:\n- 이배드 (character)\n  설명: 근미래 방랑자\n  하위 이미지별 개별 특징: 정면: 정면 샷, 흉터 보임");
  });

  it("falls back to the Asset's own type when usage_role is blank, and to a placeholder when description is blank", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-selection-"));
    const assets = new LocalAssetsRepository(root);
    const asset = await assets.create({ buffer: pngA, originalname: "city.png" }, { assetType: "background", displayName: "폐허 기록관" });
    const mapping = fixtureMapping({ asset_id: asset.asset_id, usage_role: " " });

    const result = await describeReferenceMappingsForScene(assets, [mapping], 1);

    expect(result).toBe("References:\n- 폐허 기록관 (background)\n  설명: 별도 설명 없음");
  });

  it("returns an empty string when no confirmed mapping is in scope for the scene, without an empty References heading", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-selection-"));
    const assets = new LocalAssetsRepository(root);
    const asset = await assets.create({ buffer: pngA, originalname: "hero.png" }, { assetType: "character", displayName: "이배드", description: "설명" });
    const outOfScope = fixtureMapping({ asset_id: asset.asset_id, scene_scope: { mode: "scene", scene: 2 } });
    const unconfirmed = fixtureMapping({ asset_id: asset.asset_id, status: "suggested" });

    expect(await describeReferenceMappingsForScene(assets, [outOfScope, unconfirmed], 1)).toBe("");
    expect(await describeReferenceMappingsForScene(assets, [], 1)).toBe("");
  });
});

describe("the continuity image's recorded name", () => {
  /**
   * The name was the constant "continuity", so the record said a continuity image existed and never which one.
   * Relinking scene 1 to a different project, or the linked project redrawing its final scene, left the recorded
   * name character-for-character identical — the staleness check could see the reference appear and disappear and
   * never see it become a different picture, so pictures drawn from a reference that no longer exists reported
   * themselves as current. Regeneration rewrites the same path, so the path cannot carry this either.
   */
  it("changes when the linked picture is replaced, though the path it lives at does not", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-continuity-"));
    const assets = new LocalAssetsRepository(root);
    const continuityPath = path.join(root, "previous-final-scene.png");
    await fs.writeFile(continuityPath, pngA);

    const before = await referenceSourcesForScene(assets, [], root, 1 as SceneNumber, continuityPath);

    // The same path, a different picture — exactly what a regeneration in the linked project leaves behind.
    await fs.writeFile(continuityPath, Buffer.concat([pngB, Buffer.alloc(64)]));
    const after = await referenceSourcesForScene(assets, [], root, 1 as SceneNumber, continuityPath);

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toEqual(before[0]);
  });

  it("still says nothing at all when there is no continuity image, and never leaks an absolute path into the record", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-continuity-none-"));
    const assets = new LocalAssetsRepository(root);
    const continuityPath = path.join(root, "previous-final-scene.png");
    await fs.writeFile(continuityPath, pngA);

    expect(await referenceSourcesForScene(assets, [], root, 1 as SceneNumber, null)).toEqual([]);
    // Scene 2 has never been offered the previous project's picture — only scene 1 is.
    expect(await referenceSourcesForScene(assets, [], root, 2 as SceneNumber, continuityPath)).toEqual([]);

    // A recorded name is compared across runs and read by a person; the machine's directory layout is neither
    // stable nor meaningful, and a moved data directory would otherwise read as every reference having changed.
    const [source = ""] = await referenceSourcesForScene(assets, [], root, 1 as SceneNumber, continuityPath);
    expect(source.startsWith("continuity:")).toBe(true);
    expect(source).not.toContain(root);
  });
});
