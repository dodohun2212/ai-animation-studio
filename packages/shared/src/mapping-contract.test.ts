import { describe, expect, it } from "vitest";
import { API_ROUTES } from "./api.js";
import type {
  AssetMappingSceneScope,
  ProjectAssetMapping,
  ProjectAssetMappingReview,
} from "./mapping.js";

describe("project asset mapping contract", () => {
  it("encodes project and mapping identifiers in routes", () => {
    expect(API_ROUTES.projectAssetMappings("한글 project")).toBe(
      "/projects/%ED%95%9C%EA%B8%80%20project/assets/mappings",
    );
    expect(API_ROUTES.projectAssetMapping("p/1", "m?1")).toBe(
      "/projects/p%2F1/assets/mappings/m%3F1",
    );
  });

  it("keeps the Python mapping and review fields explicit", () => {
    const scope: AssetMappingSceneScope = { kind: "list", sceneNumbers: [1, 3, 6] };
    const mapping: ProjectAssetMapping = {
      mappingId: "mapping-1",
      projectId: "project-1",
      assetId: "asset-1",
      enabled: true,
      usageRole: "character",
      sceneScope: scope,
      assignmentSource: "manual",
      confidence: 1,
      matchReason: "explicit user selection",
      status: "confirmed",
      userConfirmed: true,
      versionPolicy: "pinned_version",
      pinnedVersion: 2,
      candidateOnly: false,
      createdAt: "2026-08-22T00:00:00Z",
      updatedAt: "2026-08-22T00:00:00Z",
      snapshot: null,
      selectedChildAssetIds: [],
    };
    const review: ProjectAssetMappingReview = {
      projectId: "project-1",
      mappingRevision: 3,
      scriptRevision: 2,
      scriptFingerprint: "a".repeat(64),
      status: "waiting",
      approvedAt: null,
      approvedBy: null,
      textOnlyConfirmed: false,
      legacyConfirmed: false,
      reviewedScenes: [1, 3, 6],
    };
    expect(mapping.sceneScope).toEqual(scope);
    expect(review.scriptFingerprint).toHaveLength(64);
  });
});
