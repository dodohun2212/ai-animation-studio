import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StoredAssetMapping } from "../mappings/mapping-storage.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { collectReferenceImages } from "./image-reference-selection.js";

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
    const results = await collectReferenceImages(assets, [mapping], path.join(root, "projects"), "p1", 1, null);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(pngB);
  });

  it("skips a Folder mapping with no representative image rather than failing the whole scene", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "image-reference-selection-"));
    const assets = new LocalAssetsRepository(root);
    const emptyFolder = await assets.createFolder({ assetType: "style", displayName: "Empty" });
    const mapping = fixtureMapping({ asset_id: emptyFolder.asset_id, version_policy: "follow_latest", pinned_version: null });

    const results = await collectReferenceImages(assets, [mapping], path.join(root, "projects"), "p1", 1, null);
    expect(results).toEqual([]);
  });
});
