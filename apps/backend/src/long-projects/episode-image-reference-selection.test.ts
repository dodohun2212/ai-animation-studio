import * as fs from "node:fs/promises";
import * as os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { LongEpisodeAssetMappingCandidate } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { collectEpisodeReferenceImages, MAX_REFERENCE_IMAGES } from "./episode-image-reference-selection.js";

const png = (byte: number) => Buffer.from(`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=${byte}`, "base64");
let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

function fixtureCandidate(overrides: Partial<LongEpisodeAssetMappingCandidate>): LongEpisodeAssetMappingCandidate {
  return {
    mappingId: "MAP-1", sourceCollection: "characters", sourceItemId: "hero", assetId: "ASSET-1",
    usageRole: "character", versionPolicy: "follow_latest", pinnedVersion: null,
    episodeScope: { mode: "all" }, status: "confirmed", userConfirmed: true,
    ...overrides,
  };
}

describe("collectEpisodeReferenceImages", () => {
  it("counts images left out once MAX_REFERENCE_IMAGES is reached, but never counts a candidate that never resolved to a file", async () => {
    root = await fs.mkdtemp(os.tmpdir() + "/episode-reference-selection-");
    const assets = new LocalAssetsRepository(root);
    const created = await Promise.all(Array.from({ length: 17 }, (_, index) =>
      assets.create({ buffer: png(index), originalname: `ref${index}.png` }, { assetType: "character", displayName: `Ref ${index}` })));
    const candidates = created.map((asset, index) => fixtureCandidate({ mappingId: `MAP-${index}`, sourceItemId: `item-${index}`, assetId: asset.asset_id }));
    // An 18th candidate whose Asset was removed after being confirmed — never resolves to a file, so must not
    // count toward omittedCount even though it comes last in iteration order.
    candidates.push(fixtureCandidate({ mappingId: "MAP-missing", sourceItemId: "missing", assetId: "ASSET-DOES-NOT-EXIST" }));

    const collected = await collectEpisodeReferenceImages(assets, candidates, 1, 1, null);

    expect(collected.images).toHaveLength(MAX_REFERENCE_IMAGES);
    expect(collected.omittedCount).toBe(1); // 17 real images - 16 sent = 1 left out; the missing-Asset candidate is not counted.
  });

  it("only counts candidates in scope for this Episode", async () => {
    root = await fs.mkdtemp(os.tmpdir() + "/episode-reference-selection-");
    const assets = new LocalAssetsRepository(root);
    const asset = await assets.create({ buffer: png(0), originalname: "ref.png" }, { assetType: "character", displayName: "Ref" });
    const inScope = fixtureCandidate({ assetId: asset.asset_id, episodeScope: { mode: "episode", episode: 2 } });
    const outOfScope = fixtureCandidate({ mappingId: "MAP-2", assetId: asset.asset_id, episodeScope: { mode: "episode", episode: 3 } });

    const collected = await collectEpisodeReferenceImages(assets, [inScope, outOfScope], 2, 1, null);

    expect(collected.images).toHaveLength(1);
    expect(collected.omittedCount).toBe(0);
  });

  it("never counts an unconfirmed candidate", async () => {
    root = await fs.mkdtemp(os.tmpdir() + "/episode-reference-selection-");
    const assets = new LocalAssetsRepository(root);
    const asset = await assets.create({ buffer: png(0), originalname: "ref.png" }, { assetType: "character", displayName: "Ref" });
    const suggested = fixtureCandidate({ assetId: asset.asset_id, status: "suggested" });

    const collected = await collectEpisodeReferenceImages(assets, [suggested], 1, 1, null);

    expect(collected.images).toEqual([]);
    expect(collected.omittedCount).toBe(0);
  });
});
