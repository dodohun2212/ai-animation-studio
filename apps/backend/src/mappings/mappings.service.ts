import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import { MAX_SCENE_COUNT, sceneNumbersFor } from "@ai-animation-studio/shared";
import type {
  ApproveProjectAssetMappingReviewRequest, BeginProjectAssetMappingReviewRequest, CreateProjectAssetMappingRequest,
  CreateProjectAssetMappingResponse, BeginProjectAssetMappingReviewResponse, GetProjectAssetMappingReviewResponse, ApproveProjectAssetMappingReviewResponse,
  ListProjectAssetMappingsResponse, SnapshotProjectAssetMappingResponse, UpdateProjectAssetMappingRequest,
  UpdateProjectAssetMappingResponse, AssetMappingVersionPolicy, SceneNumber,
} from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import type { MappingOwner, MappingOwners } from "./mapping-owner.js";
import { invalidMappingRequest, mappingAssetNotFound, approvalBlocked, fingerprintMismatch, snapshotInvalid } from "./mapping-api.error.js";
import { scriptFingerprint, LocalProjectAssetMappingsRepository } from "./mappings.repository.js";
import { parseScope, scopeIncludes, toPublicMapping, toPublicReview, toStoredScope, type StoredAssetMapping, type StoredMappingReview } from "./mapping-storage.js";

function scenesFor(owner: MappingOwner): SceneNumber[] {
  return sceneNumbersFor(owner.sceneCount);
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const policy = (value: unknown): value is AssetMappingVersionPolicy => value === "pinned_version" || value === "follow_latest" || value === "snapshot";
const scopeFromRequest = (value: unknown, sceneCount: number) => {
  if (!isObject(value) || typeof value.kind !== "string") throw invalidMappingRequest("Scene scope is invalid.");
  if (value.kind === "all" && Object.keys(value).length === 1) return { kind: "all" } as const;
  if (value.kind === "scene" && Number.isInteger(value.sceneNumber) && Number(value.sceneNumber) >= 1 && Number(value.sceneNumber) <= sceneCount && Object.keys(value).length === 2) return { kind: "scene", sceneNumber: value.sceneNumber as SceneNumber } as const;
  if (value.kind === "range" && Number.isInteger(value.startScene) && Number.isInteger(value.endScene) && Number(value.startScene) >= 1 && Number(value.endScene) <= sceneCount && Number(value.startScene) <= Number(value.endScene) && Object.keys(value).length === 3) return { kind: "range", startScene: value.startScene as SceneNumber, endScene: value.endScene as SceneNumber } as const;
  if (value.kind === "list" && Array.isArray(value.sceneNumbers) && value.sceneNumbers.length > 0 && value.sceneNumbers.every((item) => Number.isInteger(item) && Number(item) >= 1 && Number(item) <= sceneCount) && new Set(value.sceneNumbers).size === value.sceneNumbers.length && Object.keys(value).length === 2) return { kind: "list", sceneNumbers: [...value.sceneNumbers].sort((a, b) => a - b) as SceneNumber[] } as const;
  throw invalidMappingRequest("Scene scope is invalid.");
};
const mappingsScenes = (owner: MappingOwner) => {
  const scenes = scenesFor(owner);
  if (owner.scenes.length !== scenes.length) throw approvalBlocked(`Exactly ${scenes.length} Story scenes are required before Asset Mapping review.`);
  const numbers = owner.scenes.map((scene) => isObject(scene) ? scene.number : undefined);
  if (!numbers.every((number, index) => number === index + 1)) throw approvalBlocked(`Story scenes must be ordered from 1 through ${scenes.length} before Asset Mapping review.`);
  return [...owner.scenes];
};

@Injectable()
/**
 * The asset-mapping flow, over whatever owns the mappings.
 *
 * `Key` defaults to a short project's id, so every existing caller reads exactly as before. An Episode names
 * itself with two values and supplies its own key type rather than encoding both into one string.
 */
export class ProjectAssetMappingsService<Key = string> {
  constructor(private readonly repository: LocalProjectAssetMappingsRepository, private readonly assets: LocalAssetsRepository, private readonly owners: MappingOwners<Key>) {}

  async list(key: Key): Promise<ListProjectAssetMappingsResponse> {
    return { mappings: (await this.repository.load(await this.owners.get(key))).map(toPublicMapping) };
  }
  async review(key: Key): Promise<GetProjectAssetMappingReviewResponse> {
    return { review: toPublicReview(await this.repository.loadReview(await this.owners.get(key))) };
  }
  async create(key: Key, body: unknown): Promise<CreateProjectAssetMappingResponse> {
    if (!isObject(body) || Object.keys(body).some((key) => !["assetId", "usageRole", "sceneScope", "versionPolicy", "pinnedVersion", "selectedChildAssetIds"].includes(key))
      || typeof body.assetId !== "string" || !body.assetId.trim() || typeof body.usageRole !== "string" || !body.usageRole.trim() || body.usageRole.trim().length > 80
      || !(body.versionPolicy === undefined || policy(body.versionPolicy)) || !(body.pinnedVersion === undefined || body.pinnedVersion === null || (Number.isInteger(body.pinnedVersion) && Number(body.pinnedVersion) >= 1))
      || !(body.selectedChildAssetIds === undefined || (Array.isArray(body.selectedChildAssetIds) && body.selectedChildAssetIds.every((item) => typeof item === "string" && item.length > 0)))) throw invalidMappingRequest("Asset Mapping request is invalid.");
    const request = body as unknown as CreateProjectAssetMappingRequest;
    const asset = await this.asset(request.assetId);
    const owner = await this.owners.get(key);
    const sceneScope = scopeFromRequest(request.sceneScope, owner.sceneCount);
    const versionPolicy = request.versionPolicy ?? (asset.is_folder ? "follow_latest" : "pinned_version");
    if (versionPolicy === "snapshot") throw invalidMappingRequest("Create a snapshot with the snapshot endpoint.");
    // A Folder has no versions of its own — its bytes always come from whichever child is currently its
    // representative image, so only follow_latest is meaningful (pinning/snapshotting a Folder makes no sense).
    if (asset.is_folder && versionPolicy !== "follow_latest") throw invalidMappingRequest("A Folder Asset Mapping only supports follow_latest.");
    const pinnedVersion = request.pinnedVersion ?? asset.version;
    if (!asset.is_folder && !asset.versions.some((version) => version.version === pinnedVersion)) throw invalidMappingRequest("Pinned Asset version does not exist.");
    const now = new Date().toISOString();
    const mapping: StoredAssetMapping = { mapping_id: `MAP-${crypto.randomBytes(8).toString("hex").toUpperCase()}`, project_id: owner.id, asset_id: asset.asset_id, enabled: true, usage_role: request.usageRole.trim(), scene_scope: toStoredScope(sceneScope), assignment_source: "manual", confidence: null, match_reason: "manual_assignment", status: "confirmed", user_confirmed: true, version_policy: versionPolicy, pinned_version: pinnedVersion, candidate_only: false, created_at: now, updated_at: now, snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [...new Set(request.selectedChildAssetIds ?? [])] };
    const mappings = await this.repository.load(owner); mappings.push(mapping); await this.repository.save(owner, mappings);
    return { mapping: toPublicMapping(mapping) };
  }
  async update(key: Key, mappingId: string, body: unknown): Promise<UpdateProjectAssetMappingResponse> {
    if (!isObject(body) || Object.keys(body).length === 0 || Object.keys(body).some((key) => !["decision", "enabled", "versionPolicy", "pinnedVersion"].includes(key))
      || !(body.decision === undefined || body.decision === "confirm" || body.decision === "exclude") || !(body.enabled === undefined || typeof body.enabled === "boolean")
      || !(body.versionPolicy === undefined || policy(body.versionPolicy)) || !(body.pinnedVersion === undefined || body.pinnedVersion === null || (Number.isInteger(body.pinnedVersion) && Number(body.pinnedVersion) >= 1))) throw invalidMappingRequest("Asset Mapping update is invalid.");
    const request = body as unknown as UpdateProjectAssetMappingRequest;
    if (request.versionPolicy === "snapshot") throw invalidMappingRequest("Create a snapshot with the snapshot endpoint.");
    const owner = await this.owners.get(key);
    const mappings = await this.repository.load(owner); const mapping = mappings.find((item) => item.mapping_id === mappingId);
    if (!mapping) return Promise.reject((await import("./mapping-api.error.js")).mappingNotFound());
    if (request.decision === "confirm") { mapping.status = "confirmed"; mapping.user_confirmed = true; mapping.candidate_only = false; }
    if (request.decision === "exclude") { mapping.status = "excluded"; mapping.user_confirmed = false; mapping.enabled = false; }
    if (request.enabled !== undefined) mapping.enabled = request.enabled;
    if (request.versionPolicy !== undefined) {
      const asset = await this.asset(mapping.asset_id); const pin = request.pinnedVersion ?? asset.version;
      if (asset.is_folder && request.versionPolicy !== "follow_latest") throw invalidMappingRequest("A Folder Asset Mapping only supports follow_latest.");
      if (!asset.is_folder && !asset.versions.some((version) => version.version === pin)) throw invalidMappingRequest("Pinned Asset version does not exist.");
      mapping.version_policy = request.versionPolicy; mapping.pinned_version = pin; mapping.snapshot_path = null; mapping.snapshot_sha256 = null; mapping.snapshot_source_version = null;
    }
    mapping.updated_at = new Date().toISOString(); const review = await this.repository.save(owner, mappings);
    return { mapping: toPublicMapping(mapping), review: toPublicReview(review) };
  }
  async beginReview(key: Key, body: unknown): Promise<BeginProjectAssetMappingReviewResponse> {
    if (!isObject(body) || Object.keys(body).some((key) => !["scriptRevision", "reviewedScenes", "textOnlyConfirmed", "legacyConfirmed"].includes(key)) || !Number.isInteger(body.scriptRevision) || Number(body.scriptRevision) < 0
      || !(body.reviewedScenes === undefined || (Array.isArray(body.reviewedScenes) && body.reviewedScenes.every((number) => Number.isInteger(number) && Number(number) >= 1 && Number(number) <= MAX_SCENE_COUNT) && new Set(body.reviewedScenes).size === body.reviewedScenes.length))
      || !(body.textOnlyConfirmed === undefined || typeof body.textOnlyConfirmed === "boolean") || !(body.legacyConfirmed === undefined || typeof body.legacyConfirmed === "boolean")) throw invalidMappingRequest("Asset Mapping review request is invalid.");
    const request = body as unknown as BeginProjectAssetMappingReviewRequest; const owner = await this.owners.get(key); const scenes = mappingsScenes(owner); const sceneList = scenesFor(owner);
    if (!(request.reviewedScenes === undefined || request.reviewedScenes.every((number) => sceneList.includes(number)))) throw invalidMappingRequest("Asset Mapping review request is invalid.");
    if (request.scriptRevision !== owner.scriptRevision) throw invalidMappingRequest("scriptRevision must match the current project script revision.");
    const previous = await this.repository.loadReview(owner); const review: StoredMappingReview = { project_id: owner.id, mapping_revision: previous.mapping_revision + 1, script_revision: owner.scriptRevision, script_fingerprint: scriptFingerprint(scenes), status: "waiting", approved_at: "", approved_by: "", text_only_confirmed: request.textOnlyConfirmed ?? false, legacy_confirmed: request.legacyConfirmed ?? false, reviewed_scenes: [...(request.reviewedScenes ?? [])] };
    await this.repository.saveReview(owner, review); return { review: toPublicReview(review) };
  }
  async approveReview(key: Key, body: unknown): Promise<ApproveProjectAssetMappingReviewResponse> {
    if (!isObject(body) || Object.keys(body).some((key) => !["scriptFingerprint", "approvedBy"].includes(key)) || typeof body.scriptFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.scriptFingerprint) || !(body.approvedBy === undefined || (typeof body.approvedBy === "string" && body.approvedBy.trim().length > 0 && body.approvedBy.length <= 80))) throw invalidMappingRequest("Asset Mapping approval request is invalid.");
    const request = body as unknown as ApproveProjectAssetMappingReviewRequest; const owner = await this.owners.get(key); const scenes = mappingsScenes(owner); const sceneList = scenesFor(owner); const currentFingerprint = scriptFingerprint(scenes); const review = await this.repository.loadReview(owner);
    if (review.script_revision !== owner.scriptRevision || review.script_fingerprint !== currentFingerprint || request.scriptFingerprint !== currentFingerprint) { const invalidated = { ...review, mapping_revision: review.mapping_revision + 1, script_revision: owner.scriptRevision, script_fingerprint: currentFingerprint, status: "waiting" as const, approved_at: "", approved_by: "", reviewed_scenes: [] }; await this.repository.saveReview(owner, invalidated); throw fingerprintMismatch(); }
    const mappings = (await this.repository.load(owner)).filter((mapping) => !mapping.candidate_only);
    const blocked = mappings.filter((mapping) => mapping.status === "suggested" || mapping.status === "ambiguous" || mapping.status === "invalid" || (mapping.status === "unmatched" && !mapping.user_confirmed));
    if (blocked.length) throw approvalBlocked("Unconfirmed Asset Mappings must be resolved before approval.", { mappingIds: blocked.map((item) => item.mapping_id) });
    if (!mappings.length && !review.text_only_confirmed && !review.legacy_confirmed) throw approvalBlocked("Text-only or legacy confirmation is required when no Asset Mapping exists.");
    if (mappings.length && !review.legacy_confirmed) {
      const covered = sceneList.filter((number) => mappings.some((mapping) => scopeIncludes(mapping.scene_scope, number) && (mapping.status === "confirmed" || mapping.status === "excluded" || (mapping.status === "unmatched" && mapping.user_confirmed))));
      if (covered.length !== sceneList.length) throw approvalBlocked("Every scene requires a confirmed, excluded, or explicitly unmatched mapping.", { missingSceneNumbers: sceneList.filter((number) => !covered.includes(number)) });
    }
    const approved: StoredMappingReview = { ...review, status: "approved", approved_at: new Date().toISOString(), approved_by: request.approvedBy?.trim() || "user", reviewed_scenes: [...sceneList] };
    await this.repository.saveReview(owner, approved);
    await owner.markMappingApproved(approved.mapping_revision);
    return { review: toPublicReview(approved) };
  }
  async snapshot(key: Key, mappingId: string): Promise<SnapshotProjectAssetMappingResponse> {
    const owner = await this.owners.get(key);
    const mappings = await this.repository.load(owner); const mapping = mappings.find((item) => item.mapping_id === mappingId);
    if (!mapping) return Promise.reject((await import("./mapping-api.error.js")).mappingNotFound());
    const asset = await this.asset(mapping.asset_id); const version = mapping.pinned_version ?? asset.version; const storedVersion = asset.versions.find((item) => item.version === version);
    if (!storedVersion) throw snapshotInvalid();
    const source = this.assets.resolveVersionContentPath(asset, storedVersion.version);
    if (!source) throw snapshotInvalid();
    await this.repository.snapshot(owner, mapping, source, version); await this.repository.save(owner, mappings); return { mapping: toPublicMapping(mapping) };
  }
  private async asset(assetId: string) { try { return await this.assets.get(assetId); } catch { throw mappingAssetNotFound(); } }
}
