import { describe, expect, expectTypeOf, it } from "vitest";

import {
  API_ROUTES,
  type Asset,
  type AssetOwnership,
  type AssetStatus,
  type AssetType,
  type CreateAssetMetadata,
  type DeleteAssetResponse,
  type GetAssetResponse,
  type ListAssetsQuery,
  type UpdateAssetMetadataRequest,
} from "./index.js";

const legacyCompatibleAsset: Asset = {
  assetId: "ASSET-CHAR-1",
  assetType: "character",
  displayName: "Hero",
  description: "Main character",
  originalFilename: "scene1.png",
  contentSha256: "abc123",
  imageAvailable: true,
  contentUrl: "/assets/ASSET-CHAR-1/content",
  tags: ["hero"],
  aliases: ["lead"],
  enabled: true,
  approved: false,
  faceBaseline: true,
  characterKey: "hero",
  version: 1,
  versions: [{ version: 1, contentSha256: "abc123", createdAt: "2026-08-22T00:00:00Z", notes: "" }],
  createdAt: "2026-08-22T00:00:00Z",
  updatedAt: "2026-08-22T00:00:00Z",
  notes: "",
  legacyAssetIds: [],
  status: "generated",
  sourceProjectId: "demo",
  sourceSceneNumber: 1,
  referenceImages: [{ role: "front", contentSha256: "abc123", originalFilename: "scene1.png" }],
  referenceRoles: ["front"],
  isFolder: false,
  parentFolderId: "",
  childAssetIds: [],
  thumbnailAssetId: "",
  role: "",
  sortOrder: 0,
};

describe("Asset Library contract", () => {
  it("uses centralized minimal CRUD routes", () => {
    expect(API_ROUTES.assets).toBe("/assets");
    expect(API_ROUTES.asset("ASSET-CHAR-1")).toBe("/assets/ASSET-CHAR-1");
    expect(API_ROUTES.assetContent("ASSET/CHAR 1")).toBe("/assets/ASSET%2FCHAR%201/content");
    expect(API_ROUTES.asset("ASSET/CHAR 1")).toBe("/assets/ASSET%2FCHAR%201");
  });

  it("keeps exact Python category, status, and ownership unions", () => {
    expectTypeOf<AssetType>().toEqualTypeOf<"character" | "style" | "background" | "object" | "general_reference">();
    expectTypeOf<AssetStatus>().toEqualTypeOf<"generated" | "approved" | "rejected" | "replaced" | "missing" | "manual">();
    expectTypeOf<AssetOwnership>().toEqualTypeOf<"library_manual" | "project_owned" | "external">();
  });

  it("represents the complete legacy record without exposing snake_case", () => {
    expect(Object.keys(legacyCompatibleAsset)).toEqual([
      "assetId", "assetType", "displayName", "description", "originalFilename",
      "contentSha256", "imageAvailable", "contentUrl", "tags", "aliases", "enabled",
      "approved", "faceBaseline", "characterKey", "version", "versions",
      "createdAt", "updatedAt", "notes", "legacyAssetIds", "status",
      "sourceProjectId", "sourceSceneNumber", "referenceImages", "referenceRoles",
      "isFolder", "parentFolderId", "childAssetIds", "thumbnailAssetId", "role", "sortOrder",
    ]);
    expect(Object.keys(legacyCompatibleAsset).some((key) => key.includes("_"))).toBe(false);
    expect("storedPath" in legacyCompatibleAsset).toBe(false);
    expect("path" in legacyCompatibleAsset.referenceImages[0]!).toBe(false);
    expect("storedPath" in legacyCompatibleAsset.versions[0]!).toBe(false);
  });

  it("supports list search/type filters and derived safe deletion details", () => {
    const query: ListAssetsQuery = { query: "hero", assetType: "character" };
    const details: GetAssetResponse = {
      asset: legacyCompatibleAsset,
      usageProjectIds: ["demo"],
      ownership: "project_owned",
      canDeleteOwnedFile: false,
    };
    const deleted: DeleteAssetResponse = { assetId: legacyCompatibleAsset.assetId, deletedOwnedFile: false };
    expect(query).toEqual({ query: "hero", assetType: "character" });
    expect(details.usageProjectIds).toEqual(["demo"]);
    expect(deleted.deletedOwnedFile).toBe(false);
  });

  it("keeps upload bytes and server paths outside metadata DTOs", () => {
    expectTypeOf<keyof CreateAssetMetadata>().toEqualTypeOf<
      "assetType" | "displayName" | "description" | "tags" | "aliases" |
      "approved" | "faceBaseline" | "characterKey" | "notes"
    >();
    expectTypeOf<keyof UpdateAssetMetadataRequest>().toEqualTypeOf<
      "assetType" | "displayName" | "description" | "tags" | "aliases" |
      "approved" | "faceBaseline" | "characterKey" | "notes" | "role"
    >();
  });
});
