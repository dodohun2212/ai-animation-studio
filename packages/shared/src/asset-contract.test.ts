import { describe, expect, expectTypeOf, it } from "vitest";

import {
  API_ROUTES,
  type Asset,
  type AssetOwnership,
  type AssetStatus,
  type AssetType,
  type CreateAssetFolderRequest,
  type CreateAssetFolderResponse,
  type CreateAssetMetadata,
  type DeleteAssetResponse,
  type GetAssetResponse,
  type ListAssetsQuery,
  type SetAssetParentFolderRequest,
  type SetAssetParentFolderResponse,
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

  it("supports creating an empty Folder of any Asset type and linking/unlinking a child into one", () => {
    expect(API_ROUTES.createAssetFolder).toBe("/assets/folders");
    expect(API_ROUTES.assetParentFolder("ASSET-CHAR-1")).toBe("/assets/ASSET-CHAR-1/parent-folder");
    expect(API_ROUTES.assetParentFolder("ASSET/CHAR 1")).toBe("/assets/ASSET%2FCHAR%201/parent-folder");

    expectTypeOf<keyof CreateAssetFolderRequest>().toEqualTypeOf<"assetType" | "displayName" | "description" | "notes">();
    const folderRequest: CreateAssetFolderRequest = { assetType: "character", displayName: "Hero" };
    const backgroundFolderRequest: CreateAssetFolderRequest = { assetType: "background", displayName: "City skylines" };
    const folderResponse: CreateAssetFolderResponse = { asset: { ...legacyCompatibleAsset, isFolder: true } };
    expect(folderRequest.displayName).toBe("Hero");
    expect(backgroundFolderRequest.assetType).toBe("background");
    expect(folderResponse.asset.isFolder).toBe(true);

    const link: SetAssetParentFolderRequest = { parentFolderId: "ASSET-FOLDER-1" };
    const unlink: SetAssetParentFolderRequest = { parentFolderId: null };
    const linkResponse: SetAssetParentFolderResponse = {
      asset: { ...legacyCompatibleAsset, parentFolderId: "ASSET-FOLDER-1" },
      folder: { ...legacyCompatibleAsset, assetId: "ASSET-FOLDER-1", isFolder: true, childAssetIds: ["ASSET-CHAR-1"] },
    };
    expect(link.parentFolderId).toBe("ASSET-FOLDER-1");
    expect(unlink.parentFolderId).toBeNull();
    expect(linkResponse.folder?.childAssetIds).toEqual(["ASSET-CHAR-1"]);
  });
});
