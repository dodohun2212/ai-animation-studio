import { ASSET_MAPPING_ASSIGNMENT_SOURCES, ASSET_MAPPING_STATUSES, ASSET_MAPPING_VERSION_POLICIES } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";
import { parseMappings, parseReview, parseStoredReview, toPublicMapping } from "./mapping-storage.js";

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
  /**
   * This is the reader for files already on disk, so the three sets it checks against had to stop being copies.
   *
   * A value added to the contract and not to a hand-written set here does not make a feature missing — it makes
   * every stored mapping carrying that value **unreadable**, and the failure has a precedent: a mode written by
   * the merge that its own storage schema refused to read back made whole projects vanish from their list with
   * no error anywhere (Cowork Round 436). So every value the contract allows has to survive a round trip.
   */
  it("reads back every status, assignment source and version policy the contract allows", () => {
    for (const status of ASSET_MAPPING_STATUSES) {
      expect(parseMappings([{ ...mapping, status }])[0]?.status, status).toBe(status);
    }
    for (const assignment_source of ASSET_MAPPING_ASSIGNMENT_SOURCES) {
      expect(parseMappings([{ ...mapping, assignment_source }])[0]?.assignment_source, assignment_source).toBe(assignment_source);
    }
    // `snapshot` is the one policy that needs its three snapshot fields, so it is given them rather than skipped.
    for (const version_policy of ASSET_MAPPING_VERSION_POLICIES) {
      const extra = version_policy === "snapshot"
        ? { snapshot_path: "asset_snapshots/a.png", snapshot_sha256: "a".repeat(64), snapshot_source_version: 1 }
        : {};
      expect(parseMappings([{ ...mapping, version_policy, ...extra }])[0]?.version_policy, version_policy).toBe(version_policy);
    }
  });

  it("rejects unknown fields, unsafe snapshot paths, and incomplete approved reviews", () => {
    expect(() => parseMappings([{ ...mapping, unknown_field: true }])).toThrow();
    expect(() => parseMappings([{ ...mapping, version_policy: "snapshot", snapshot_path: "../escape.png", snapshot_sha256: "a".repeat(64), snapshot_source_version: 1 }])).toThrow();
    expect(() => parseReview({ project_id: "project_1", mapping_revision: 1, script_revision: 1, script_fingerprint: "a".repeat(64), status: "approved", approved_at: "", approved_by: "", text_only_confirmed: false, legacy_confirmed: false, reviewed_scenes: [] })).toThrow();
  });
});

describe("review files written before the current shape", () => {
  // Both of these are real files that stopped a cycle: three long projects, two unopenable, and the one that
  // worked was the one with no review file at all. The failure was in stored data, not in code — which is why
  // it grew over time, today's projects passing and yesterday's not.
  const legacyWaiting = {
    project_id: "12", episode_number: 1, mapping_revision: 2, script_revision: 1,
    script_fingerprint: "7803c20f", status: "waiting", text_only_confirmed: false,
    approved_at: "", candidates: [],
  };
  const legacyApproved = {
    project_id: "design-preview-long-1", episode_number: 1, mapping_revision: 0, script_revision: 0,
    script_fingerprint: "", status: "approved", text_only_confirmed: true,
    approved_at: "2026-08-24T18:01:56.049Z", candidates: [],
  };

  it("opens one whose keys and project id predate the Episode-scoped shape", () => {
    const review = parseStoredReview(legacyWaiting, "12/Episode01");
    expect(review).toMatchObject({ project_id: "12/Episode01", status: "waiting", mapping_revision: 2, script_revision: 1 });
    expect(review).not.toHaveProperty("episode_number");
    expect(review).not.toHaveProperty("candidates");
  });

  it("does not forge an approval that has no record of anyone reviewing a scene", () => {
    // Passing it through as approved would skip the missing-scene check and go on to spend money. Coming back
    // as waiting costs one more click.
    const review = parseStoredReview(legacyApproved, "design-preview-long-1/Episode01");
    expect(review).toMatchObject({ status: "waiting", approved_at: "", approved_by: "", reviewed_scenes: [] });
  });

  it("leaves another Episode's id alone, so the caller's check still refuses it", () => {
    // The reason that check exists is a file copied from one Episode into another. Only the legacy form is
    // corrected — the project half of this location's id — and another Episode's id is not that, so it comes
    // back unchanged and `loadReview` rejects it exactly as before. Correcting it here would have quietly
    // turned the copy into a valid review for the wrong Episode.
    expect(parseStoredReview({ ...legacyWaiting, project_id: "12/Episode02" }, "12/Episode01").project_id).toBe("12/Episode02");
    expect(parseStoredReview(legacyWaiting, "12/Episode01").project_id).toBe("12/Episode01");
  });
});
