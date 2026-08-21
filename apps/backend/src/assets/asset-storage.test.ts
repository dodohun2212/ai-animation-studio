import { describe, expect, it } from "vitest";
import { parseAssetIndex } from "./asset-storage.js";

const legacy = () => ({
  asset_id: "ASSET-BG-ABC", asset_type: "background", display_name: "도시", stored_path: "image.png",
  original_filename: "image.png", content_sha256: "a".repeat(64), versions: [
    { version: 1, stored_path: "image.png", content_sha256: "a".repeat(64), created_at: "2026-01-01T00:00:00+00:00", notes: "" },
  ],
});

describe("parseAssetIndex", () => {
  it("applies legacy defaults in memory", () => {
    const asset = parseAssetIndex([legacy()])[0]!;
    expect(asset.enabled).toBe(true);
    expect(asset.tags).toEqual([]);
    expect(asset.status).toBe("manual");
  });
  it("rejects unknown fields and duplicate IDs", () => {
    expect(() => parseAssetIndex([{ ...legacy(), surprise: true }])).toThrow();
    expect(() => parseAssetIndex([legacy(), legacy()])).toThrow();
  });
  it("rejects malformed nested versions", () => expect(() => parseAssetIndex([{ ...legacy(), versions: [{ version: 1 }] }])).toThrow());
  it("validates digests/current paths while allowing Python character representatives", () => {
    expect(() => parseAssetIndex([{ ...legacy(), content_sha256: "bad" }])).toThrow();
    expect(() => parseAssetIndex([{ ...legacy(), stored_path: "other.png" }])).toThrow();
    const character = {
      ...legacy(), asset_id: "ASSET-CHAR-ABC", asset_type: "character", stored_path: "front.png", content_sha256: "b".repeat(64),
      reference_roles: ["front"], reference_images: [{ role: "front", path: "front.png", content_sha256: "b".repeat(64), original_filename: "정면.png" }],
    };
    expect(parseAssetIndex([character])[0]!.original_filename).toBe("image.png");
    expect(() => parseAssetIndex([{ ...character, reference_images: [{ role: "front\nunsafe", path: "front.png", content_sha256: "b".repeat(64), original_filename: "front.png" }] }])).toThrow();
    expect(() => parseAssetIndex([{ ...character, reference_images: [{ role: "front", path: "front.png", content_sha256: "not-a-digest", original_filename: "front.png" }] }])).toThrow();
    expect(() => parseAssetIndex([{ ...character, reference_images: [{ role: "front", path: "front.png", content_sha256: "b".repeat(64), original_filename: "../front.png" }] }])).toThrow();
  });
});
