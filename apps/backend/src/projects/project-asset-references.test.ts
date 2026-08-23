import { describe, expect, it } from "vitest";
import { applyShortProjectAssetReferences, parseShortProjectAssetReferences, toShortProjectAssetReferences } from "./project-asset-references.js";
import { createStoredProject } from "./project.mapper.js";

describe("toShortProjectAssetReferences", () => {
  it("returns empty lists when lore_context has no atmosphere/scene reference fields", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    expect(toShortProjectAssetReferences(stored)).toEqual({ atmosphereAssetIds: [], sceneReferenceAssets: [] });
  });

  it("reads snake_case lore_context fields into the camelCase API shape, sorted and de-duplicated", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    stored.lore_context = {
      atmosphere_asset_ids: ["ASSET-B", "ASSET-A", "ASSET-A"],
      scene_reference_assets: { "ASSET-C": "야간 골목 배경", "ASSET-D": "주인공이 항상 들고 다니는 열쇠" },
    };
    expect(toShortProjectAssetReferences(stored)).toEqual({
      atmosphereAssetIds: ["ASSET-A", "ASSET-B"],
      sceneReferenceAssets: [
        { assetId: "ASSET-C", purpose: "야간 골목 배경" },
        { assetId: "ASSET-D", purpose: "주인공이 항상 들고 다니는 열쇠" },
      ],
    });
  });

  it("tolerates malformed legacy data instead of throwing", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    stored.lore_context = { atmosphere_asset_ids: "not-an-array", scene_reference_assets: { "ASSET-C": "", "ASSET-D": 5 } };
    expect(toShortProjectAssetReferences(stored)).toEqual({ atmosphereAssetIds: [], sceneReferenceAssets: [] });
  });
});

describe("parseShortProjectAssetReferences", () => {
  it("accepts a well-formed request", () => {
    const parsed = parseShortProjectAssetReferences({ atmosphereAssetIds: ["ASSET-A"], sceneReferenceAssets: [{ assetId: "ASSET-B", purpose: "야간 골목 배경" }] });
    expect(parsed).toEqual({ atmosphereAssetIds: ["ASSET-A"], sceneReferenceAssets: [{ assetId: "ASSET-B", purpose: "야간 골목 배경" }] });
  });

  it("trims whitespace and accepts empty lists", () => {
    const parsed = parseShortProjectAssetReferences({ atmosphereAssetIds: [" ASSET-A "], sceneReferenceAssets: [{ assetId: " ASSET-B ", purpose: " 야간 골목 배경 " }] });
    expect(parsed).toEqual({ atmosphereAssetIds: ["ASSET-A"], sceneReferenceAssets: [{ assetId: "ASSET-B", purpose: "야간 골목 배경" }] });
    expect(parseShortProjectAssetReferences({ atmosphereAssetIds: [], sceneReferenceAssets: [] })).toEqual({ atmosphereAssetIds: [], sceneReferenceAssets: [] });
  });

  it("rejects a request body with fields other than atmosphereAssetIds/sceneReferenceAssets", () => {
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: [], sceneReferenceAssets: [], extra: true })).toThrow();
    expect(() => parseShortProjectAssetReferences({})).toThrow();
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: [] })).toThrow();
    expect(() => parseShortProjectAssetReferences([])).toThrow();
  });

  it("rejects a blank atmosphereAssetIds entry", () => {
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: ["  "], sceneReferenceAssets: [] })).toThrow();
  });

  it("rejects a duplicate atmosphereAssetIds entry", () => {
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: ["A", "A"], sceneReferenceAssets: [] })).toThrow();
  });

  it("rejects a sceneReferenceAssets entry with unknown fields, missing assetId, or blank/over-length purpose", () => {
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: [], sceneReferenceAssets: [{ assetId: "A", purpose: "y", extra: true }] })).toThrow();
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: [], sceneReferenceAssets: [{ purpose: "y" }] })).toThrow();
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: [], sceneReferenceAssets: [{ assetId: "A", purpose: "  " }] })).toThrow();
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: [], sceneReferenceAssets: [{ assetId: "A", purpose: "y".repeat(201) }] })).toThrow();
  });

  it("rejects a duplicate sceneReferenceAssets assetId", () => {
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: [], sceneReferenceAssets: [
      { assetId: "A", purpose: "x" },
      { assetId: "A", purpose: "y" },
    ] })).toThrow();
  });

  it("rejects an Asset selected as both atmosphere and scene reference", () => {
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: ["A"], sceneReferenceAssets: [{ assetId: "A", purpose: "x" }] })).toThrow();
  });

  it("rejects more than 20 atmosphere Assets or 30 scene reference Assets", () => {
    const atmosphereAssetIds = Array.from({ length: 21 }, (_, index) => `A${index}`);
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds, sceneReferenceAssets: [] })).toThrow();
    const sceneReferenceAssets = Array.from({ length: 31 }, (_, index) => ({ assetId: `B${index}`, purpose: "x" }));
    expect(() => parseShortProjectAssetReferences({ atmosphereAssetIds: [], sceneReferenceAssets })).toThrow();
  });
});

describe("applyShortProjectAssetReferences", () => {
  it("writes snake_case lore_context fields while preserving other fields", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    stored.lore_context = { previous_scene_context: "context" };
    const updated = applyShortProjectAssetReferences(
      stored,
      { atmosphereAssetIds: ["ASSET-A"], sceneReferenceAssets: [{ assetId: "ASSET-B", purpose: "야간 골목 배경" }] },
      "2026-08-23T01:00:00.000Z",
    );
    expect(updated.lore_context).toEqual({
      previous_scene_context: "context",
      atmosphere_asset_ids: ["ASSET-A"],
      scene_reference_assets: { "ASSET-B": "야간 골목 배경" },
    });
    expect(updated.updated_at).toBe("2026-08-23T01:00:00.000Z");
  });
});
