import {
  MAX_SCENE_COUNT,
  type AssetMappingAssignmentSource, type AssetMappingSceneScope, type AssetMappingStatus, type AssetMappingVersionPolicy,
  type ProjectAssetMapping, type ProjectAssetMappingReview, type SceneNumber,
} from "@ai-animation-studio/shared";

export interface StoredAssetMapping {
  mapping_id: string; project_id: string; asset_id: string; enabled: boolean; usage_role: string;
  scene_scope: { mode: "all" | "scene" | "range" | "list"; scene?: SceneNumber; start?: SceneNumber; end?: SceneNumber; scenes?: SceneNumber[] };
  assignment_source: AssetMappingAssignmentSource; confidence: number | null; match_reason: string;
  status: AssetMappingStatus; user_confirmed: boolean; version_policy: AssetMappingVersionPolicy;
  pinned_version: number | null; candidate_only: boolean; created_at: string; updated_at: string;
  snapshot_path: string | null; snapshot_sha256: string | null; snapshot_source_version: number | null;
  selected_child_asset_ids: string[];
}

export interface StoredMappingReview {
  project_id: string; mapping_revision: number; script_revision: number; script_fingerprint: string;
  status: "waiting" | "approved"; approved_at: string; approved_by: string;
  text_only_confirmed: boolean; legacy_confirmed: boolean; reviewed_scenes: SceneNumber[];
}

const statuses = new Set<AssetMappingStatus>(["confirmed", "suggested", "ambiguous", "unmatched", "excluded", "invalid"]);
const sources = new Set<AssetMappingAssignmentSource>(["manual", "auto", "migrated", "approved_generated_image"]);
const policies = new Set<AssetMappingVersionPolicy>(["pinned_version", "follow_latest", "snapshot"]);
const scene = (value: unknown): value is SceneNumber => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_SCENE_COUNT;
const iso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/**
 * Every key a stored mapping may carry — including `episode_scope`, which nothing reads or writes any more.
 *
 * It is here so that Episode files written before the mapping teardown still open: dropping it from this set
 * would turn those into LONG_PROJECT_DATA_INVALID, which is a project that cannot be opened rather than a field
 * that is ignored. Listed and inert on purpose, and said out loud because a key in this set looks like a key in
 * use — the whole reason that teardown's other leftovers went unnoticed for as long as they did.
 */
const mappingKeys = new Set(["mapping_id", "project_id", "asset_id", "enabled", "usage_role", "scene_scope", "assignment_source", "confidence", "match_reason", "status", "user_confirmed", "version_policy", "pinned_version", "candidate_only", "created_at", "updated_at", "snapshot_path", "snapshot_sha256", "snapshot_source_version", "selected_child_asset_ids", "episode_scope"]);
const reviewKeys = new Set(["project_id", "mapping_revision", "script_revision", "script_fingerprint", "status", "approved_at", "approved_by", "text_only_confirmed", "legacy_confirmed", "reviewed_scenes"]);

export function parseScope(value: unknown): StoredAssetMapping["scene_scope"] {
  if (!object(value) || typeof value.mode !== "string") throw new Error("scope");
  if (value.mode === "all" && Object.keys(value).every((key) => key === "mode")) return { mode: "all" };
  if (value.mode === "scene" && scene(value.scene) && Object.keys(value).every((key) => key === "mode" || key === "scene")) return { mode: "scene", scene: value.scene };
  if (value.mode === "range" && scene(value.start) && scene(value.end) && Number(value.start) <= Number(value.end) && Object.keys(value).every((key) => key === "mode" || key === "start" || key === "end")) return { mode: "range", start: value.start, end: value.end };
  if (value.mode === "list" && Array.isArray(value.scenes) && value.scenes.length > 0 && value.scenes.every(scene) && new Set(value.scenes).size === value.scenes.length && Object.keys(value).every((key) => key === "mode" || key === "scenes")) return { mode: "list", scenes: [...value.scenes].sort((a, b) => a - b) as SceneNumber[] };
  throw new Error("scope");
}

export function toStoredScope(scope: AssetMappingSceneScope): StoredAssetMapping["scene_scope"] {
  if (scope.kind === "all") return { mode: "all" };
  if (scope.kind === "scene") return { mode: "scene", scene: scope.sceneNumber };
  if (scope.kind === "range") return { mode: "range", start: scope.startScene, end: scope.endScene };
  return { mode: "list", scenes: [...scope.sceneNumbers].sort((a, b) => a - b) };
}
export function toPublicScope(scope: StoredAssetMapping["scene_scope"]): AssetMappingSceneScope {
  if (scope.mode === "all") return { kind: "all" };
  if (scope.mode === "scene") return { kind: "scene", sceneNumber: scope.scene! };
  if (scope.mode === "range") return { kind: "range", startScene: scope.start!, endScene: scope.end! };
  return { kind: "list", sceneNumbers: [...scope.scenes!] };
}
export function scopeIncludes(scope: StoredAssetMapping["scene_scope"], number: SceneNumber): boolean {
  return scope.mode === "all" || (scope.mode === "scene" && scope.scene === number)
    || (scope.mode === "range" && scope.start! <= number && number <= scope.end!)
    || (scope.mode === "list" && scope.scenes!.includes(number));
}

export function parseMappings(value: unknown): StoredAssetMapping[] {
  if (!Array.isArray(value)) throw new Error("root");
  const ids = new Set<string>();
  return value.map((raw) => {
    if (!object(raw) || Object.keys(raw).some((key) => !mappingKeys.has(key))) throw new Error("shape");
    const item: Record<string, unknown> = { enabled: true, confidence: null, match_reason: "", status: "suggested", user_confirmed: false, version_policy: "pinned_version", pinned_version: null, candidate_only: false, snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [], ...raw };
    if (typeof item.mapping_id !== "string" || !/^MAP-[A-Z0-9]{6,64}$/.test(item.mapping_id) || ids.has(item.mapping_id)
      || typeof item.project_id !== "string" || typeof item.asset_id !== "string" || !item.asset_id
      || typeof item.enabled !== "boolean" || typeof item.usage_role !== "string" || !item.usage_role.trim()
      || !sources.has(item.assignment_source as AssetMappingAssignmentSource) || !(item.confidence === null || (typeof item.confidence === "number" && item.confidence >= 0 && item.confidence <= 1))
      || typeof item.match_reason !== "string" || !statuses.has(item.status as AssetMappingStatus) || typeof item.user_confirmed !== "boolean"
      || !policies.has(item.version_policy as AssetMappingVersionPolicy) || !(item.pinned_version === null || (Number.isInteger(item.pinned_version) && Number(item.pinned_version) >= 1))
      || typeof item.candidate_only !== "boolean" || !iso(item.created_at) || !iso(item.updated_at)
      || !(item.snapshot_path === null || (typeof item.snapshot_path === "string" && item.snapshot_path.startsWith("asset_snapshots/") && !item.snapshot_path.includes("..") && !/[\\]/.test(item.snapshot_path)))
      || !(item.snapshot_sha256 === null || (typeof item.snapshot_sha256 === "string" && /^[a-f0-9]{64}$/.test(item.snapshot_sha256)))
      || !(item.snapshot_source_version === null || (Number.isInteger(item.snapshot_source_version) && Number(item.snapshot_source_version) >= 1))
      || !strings(item.selected_child_asset_ids)) throw new Error("fields");
    const parsed = { ...item, scene_scope: parseScope(item.scene_scope) } as StoredAssetMapping;
    if (parsed.version_policy === "snapshot" && (!parsed.snapshot_path || !parsed.snapshot_sha256 || !parsed.snapshot_source_version)) throw new Error("snapshot");
    if (parsed.version_policy !== "snapshot" && (parsed.snapshot_path || parsed.snapshot_sha256 || parsed.snapshot_source_version)) throw new Error("snapshot");
    ids.add(parsed.mapping_id); return parsed;
  });
}

export function parseReview(value: unknown): StoredMappingReview {
  if (!object(value) || Object.keys(value).some((key) => !reviewKeys.has(key))) throw new Error("shape");
  const item: Record<string, unknown> = { mapping_revision: 0, script_revision: 0, script_fingerprint: "", status: "waiting", approved_at: "", approved_by: "", text_only_confirmed: false, legacy_confirmed: false, reviewed_scenes: [], ...value };
  if (typeof item.project_id !== "string" || !Number.isInteger(item.mapping_revision) || Number(item.mapping_revision) < 0
    || !Number.isInteger(item.script_revision) || Number(item.script_revision) < 0 || typeof item.script_fingerprint !== "string"
    || (item.status !== "waiting" && item.status !== "approved") || typeof item.approved_at !== "string" || typeof item.approved_by !== "string"
    || typeof item.text_only_confirmed !== "boolean" || typeof item.legacy_confirmed !== "boolean" || !Array.isArray(item.reviewed_scenes) || !item.reviewed_scenes.every(scene) || new Set(item.reviewed_scenes).size !== item.reviewed_scenes.length) throw new Error("fields");
  if (item.status === "approved" && (!iso(item.approved_at) || !item.script_fingerprint || !(item.reviewed_scenes as unknown[]).length)) throw new Error("approved");
  return item as unknown as StoredMappingReview;
}

/**
 * Keys older review files carry that this one does not. Read and dropped, never written.
 *
 * `parseReview` refuses an unknown key outright, which is right for a file this service just wrote and wrong
 * for one written months ago: a project whose review predates a field rename could not be opened at all, and
 * the screen that reports it is the door to the paid image step. Same lenient-read / strict-write split the
 * Story Bible uses for its retired fields.
 */
const retiredReviewKeys = new Set(["episode_number", "candidates"]);

/**
 * Reads a review file that may predate the current shape, and says what it can honestly say about it.
 *
 * Three things changed under stored files, and each one alone was enough to make a project unopenable:
 *
 * - keys that no longer exist (above);
 * - `project_id`, which for an Episode is now `<project>/<Episode dir>` and used to be just `<project>`. A
 *   legacy value is accepted when it is the project half of this location's id — a file copied from a
 *   *different* Episode still fails, which is the check's actual purpose;
 * - `status: "approved"` with no `reviewed_scenes`, which the current shape treats as impossible. It is not
 *   forged into an approval: an approval means someone looked at every scene, and there is no record that
 *   anyone did. It comes back as `waiting`, which costs a click and cannot spend anything.
 *
 * Writes stay strict — `saveReview` still goes through `parseReview`, so anything saved is in today's shape.
 */
export function parseStoredReview(value: unknown, locationId: string): StoredMappingReview {
  if (!object(value)) throw new Error("shape");
  const current = Object.fromEntries(Object.entries(value).filter(([key]) => !retiredReviewKeys.has(key)));
  const storedId = current.project_id;
  if (typeof storedId === "string" && storedId !== locationId && locationId.startsWith(`${storedId}/`)) current.project_id = locationId;
  if (current.status === "approved" && !(Array.isArray(current.reviewed_scenes) && current.reviewed_scenes.length)) {
    current.status = "waiting"; current.approved_at = ""; current.approved_by = "";
  }
  return parseReview(current);
}

export function toPublicMapping(mapping: StoredAssetMapping): ProjectAssetMapping {
  return { mappingId: mapping.mapping_id, projectId: mapping.project_id, assetId: mapping.asset_id, enabled: mapping.enabled, usageRole: mapping.usage_role, sceneScope: toPublicScope(mapping.scene_scope), assignmentSource: mapping.assignment_source, confidence: mapping.confidence, matchReason: mapping.match_reason, status: mapping.status, userConfirmed: mapping.user_confirmed, versionPolicy: mapping.version_policy, pinnedVersion: mapping.pinned_version, candidateOnly: mapping.candidate_only, createdAt: mapping.created_at, updatedAt: mapping.updated_at, snapshot: mapping.snapshot_path ? { relativePath: mapping.snapshot_path, sha256: mapping.snapshot_sha256!, sourceVersion: mapping.snapshot_source_version! } : null, selectedChildAssetIds: [...mapping.selected_child_asset_ids] };
}
export function toPublicReview(review: StoredMappingReview): ProjectAssetMappingReview {
  return { projectId: review.project_id, mappingRevision: review.mapping_revision, scriptRevision: review.script_revision, scriptFingerprint: review.script_fingerprint, status: review.status, approvedAt: review.approved_at || null, approvedBy: review.approved_by || null, textOnlyConfirmed: review.text_only_confirmed, legacyConfirmed: review.legacy_confirmed, reviewedScenes: [...review.reviewed_scenes] };
}
