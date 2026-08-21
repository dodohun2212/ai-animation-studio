import { describe, expect, it } from "vitest";
import { parseMappings, parseReview, toPublicMapping } from "./mapping-storage.js";

const mapping = {
  mapping_id: "MAP-ABCDEF", project_id: "project_1", asset_id: "ASSET-STYLE-ABCDEF", enabled: true, usage_role: "style",
  scene_scope: { mode: "range", start: 2, end: 4 }, assignment_source: "manual", confidence: null, match_reason: "manual_assignment",
  status: "confirmed", user_confirmed: true, version_policy: "pinned_version", pinned_version: 1, candidate_only: false,
  created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T00:00:00.000Z", snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [],
};

describe("Project Asset Mapping snake_case storage", () => {
  it("maps a valid Python-compatible record to camelCase without a filesystem path", () => {
    const parsed = parseMappings([mapping]);
    expect(toPublicMapping(parsed[0]!)).toMatchObject({ mappingId: "MAP-ABCDEF", sceneScope: { kind: "range", startScene: 2, endScene: 4 }, snapshot: null });
  });
  it("rejects unknown fields, unsafe snapshot paths, and incomplete approved reviews", () => {
    expect(() => parseMappings([{ ...mapping, unknown_field: true }])).toThrow();
    expect(() => parseMappings([{ ...mapping, version_policy: "snapshot", snapshot_path: "../escape.png", snapshot_sha256: "a".repeat(64), snapshot_source_version: 1 }])).toThrow();
    expect(() => parseReview({ project_id: "project_1", mapping_revision: 1, script_revision: 1, script_fingerprint: "a".repeat(64), status: "approved", approved_at: "", approved_by: "", text_only_confirmed: false, legacy_confirmed: false, reviewed_scenes: [] })).toThrow();
  });
});
