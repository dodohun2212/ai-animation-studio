import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import { MAX_SCENE_COUNT, sceneNumbersFor, WorkflowState } from "@ai-animation-studio/shared";
import type {
  ApproveProjectAssetMappingReviewRequest, BeginProjectAssetMappingReviewRequest, CreateProjectAssetMappingRequest,
  CreateProjectAssetMappingResponse, BeginProjectAssetMappingReviewResponse, GetProjectAssetMappingReviewResponse, ApproveProjectAssetMappingReviewResponse,
  ListProjectAssetMappingsResponse, SnapshotProjectAssetMappingResponse, UpdateProjectAssetMappingRequest,
  UpdateProjectAssetMappingResponse, AssetMappingVersionPolicy, SceneNumber,
} from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { invalidMappingRequest, mappingAssetNotFound, approvalBlocked, fingerprintMismatch, snapshotInvalid } from "./mapping-api.error.js";
import { scriptFingerprint, LocalProjectAssetMappingsRepository } from "./mappings.repository.js";
import { parseScope, scopeIncludes, toPublicMapping, toPublicReview, toStoredScope, type StoredAssetMapping, type StoredMappingReview } from "./mapping-storage.js";

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
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
const mappingsScenes = (project: StoredProject) => {
  const scenes = scenesFor(project);
  if (project.scenes.length !== scenes.length) throw approvalBlocked(`Exactly ${scenes.length} Story scenes are required before Asset Mapping review.`);
  const numbers = project.scenes.map((scene) => isObject(scene) ? scene.number : undefined);
  if (!numbers.every((number, index) => number === index + 1)) throw approvalBlocked(`Story scenes must be ordered from 1 through ${scenes.length} before Asset Mapping review.`);
  return project.scenes;
};

@Injectable()
export class ProjectAssetMappingsService {
  constructor(private readonly repository: LocalProjectAssetMappingsRepository, private readonly assets: LocalAssetsRepository, private readonly projects?: LocalProjectRepository) {}

  async list(projectId: string): Promise<ListProjectAssetMappingsResponse> {
    return { mappings: (await this.repository.load(projectId)).map(toPublicMapping) };
  }
  async review(projectId: string): Promise<GetProjectAssetMappingReviewResponse> {
    return { review: toPublicReview(await this.repository.loadReview(projectId)) };
  }
  async create(projectId: string, body: unknown): Promise<CreateProjectAssetMappingResponse> {
    if (!isObject(body) || Object.keys(body).some((key) => !["assetId", "usageRole", "sceneScope", "versionPolicy", "pinnedVersion", "selectedChildAssetIds"].includes(key))
      || typeof body.assetId !== "string" || !body.assetId.trim() || typeof body.usageRole !== "string" || !body.usageRole.trim() || body.usageRole.trim().length > 80
      || !(body.versionPolicy === undefined || policy(body.versionPolicy)) || !(body.pinnedVersion === undefined || body.pinnedVersion === null || (Number.isInteger(body.pinnedVersion) && Number(body.pinnedVersion) >= 1))
      || !(body.selectedChildAssetIds === undefined || (Array.isArray(body.selectedChildAssetIds) && body.selectedChildAssetIds.every((item) => typeof item === "string" && item.length > 0)))) throw invalidMappingRequest("Asset Mapping request is invalid.");
    const request = body as unknown as CreateProjectAssetMappingRequest;
    const asset = await this.asset(request.assetId);
    if (asset.is_folder) throw invalidMappingRequest("A folder cannot be mapped as an Asset.");
    const project = await this.repository.project(projectId);
    const sceneScope = scopeFromRequest(request.sceneScope, toShortProjectSettings(project).sceneCount);
    const versionPolicy = request.versionPolicy ?? "pinned_version";
    if (versionPolicy === "snapshot") throw invalidMappingRequest("Create a snapshot with the snapshot endpoint.");
    const pinnedVersion = request.pinnedVersion ?? asset.version;
    if (!asset.versions.some((version) => version.version === pinnedVersion)) throw invalidMappingRequest("Pinned Asset version does not exist.");
    const now = new Date().toISOString();
    const mapping: StoredAssetMapping = { mapping_id: `MAP-${crypto.randomBytes(8).toString("hex").toUpperCase()}`, project_id: projectId, asset_id: asset.asset_id, enabled: true, usage_role: request.usageRole.trim(), scene_scope: toStoredScope(sceneScope), assignment_source: "manual", confidence: null, match_reason: "manual_assignment", status: "confirmed", user_confirmed: true, version_policy: versionPolicy, pinned_version: pinnedVersion, candidate_only: false, created_at: now, updated_at: now, snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [...new Set(request.selectedChildAssetIds ?? [])] };
    const mappings = await this.repository.load(projectId); mappings.push(mapping); await this.repository.save(projectId, mappings);
    return { mapping: toPublicMapping(mapping) };
  }
  async update(projectId: string, mappingId: string, body: unknown): Promise<UpdateProjectAssetMappingResponse> {
    if (!isObject(body) || Object.keys(body).length === 0 || Object.keys(body).some((key) => !["decision", "enabled", "versionPolicy", "pinnedVersion"].includes(key))
      || !(body.decision === undefined || body.decision === "confirm" || body.decision === "exclude") || !(body.enabled === undefined || typeof body.enabled === "boolean")
      || !(body.versionPolicy === undefined || policy(body.versionPolicy)) || !(body.pinnedVersion === undefined || body.pinnedVersion === null || (Number.isInteger(body.pinnedVersion) && Number(body.pinnedVersion) >= 1))) throw invalidMappingRequest("Asset Mapping update is invalid.");
    const request = body as unknown as UpdateProjectAssetMappingRequest;
    if (request.versionPolicy === "snapshot") throw invalidMappingRequest("Create a snapshot with the snapshot endpoint.");
    const mappings = await this.repository.load(projectId); const mapping = mappings.find((item) => item.mapping_id === mappingId);
    if (!mapping) return Promise.reject((await import("./mapping-api.error.js")).mappingNotFound());
    if (request.decision === "confirm") { mapping.status = "confirmed"; mapping.user_confirmed = true; mapping.candidate_only = false; }
    if (request.decision === "exclude") { mapping.status = "excluded"; mapping.user_confirmed = false; mapping.enabled = false; }
    if (request.enabled !== undefined) mapping.enabled = request.enabled;
    if (request.versionPolicy !== undefined) {
      const asset = await this.asset(mapping.asset_id); const pin = request.pinnedVersion ?? asset.version;
      if (!asset.versions.some((version) => version.version === pin)) throw invalidMappingRequest("Pinned Asset version does not exist.");
      mapping.version_policy = request.versionPolicy; mapping.pinned_version = pin; mapping.snapshot_path = null; mapping.snapshot_sha256 = null; mapping.snapshot_source_version = null;
    }
    mapping.updated_at = new Date().toISOString(); const review = await this.repository.save(projectId, mappings);
    return { mapping: toPublicMapping(mapping), review: toPublicReview(review) };
  }
  async beginReview(projectId: string, body: unknown): Promise<BeginProjectAssetMappingReviewResponse> {
    if (!isObject(body) || Object.keys(body).some((key) => !["scriptRevision", "reviewedScenes", "textOnlyConfirmed", "legacyConfirmed"].includes(key)) || !Number.isInteger(body.scriptRevision) || Number(body.scriptRevision) < 0
      || !(body.reviewedScenes === undefined || (Array.isArray(body.reviewedScenes) && body.reviewedScenes.every((number) => Number.isInteger(number) && Number(number) >= 1 && Number(number) <= MAX_SCENE_COUNT) && new Set(body.reviewedScenes).size === body.reviewedScenes.length))
      || !(body.textOnlyConfirmed === undefined || typeof body.textOnlyConfirmed === "boolean") || !(body.legacyConfirmed === undefined || typeof body.legacyConfirmed === "boolean")) throw invalidMappingRequest("Asset Mapping review request is invalid.");
    const request = body as unknown as BeginProjectAssetMappingReviewRequest; const project = await this.repository.project(projectId); const scenes = mappingsScenes(project); const sceneList = scenesFor(project);
    if (!(request.reviewedScenes === undefined || request.reviewedScenes.every((number) => sceneList.includes(number)))) throw invalidMappingRequest("Asset Mapping review request is invalid.");
    if (request.scriptRevision !== project.script_revision) throw invalidMappingRequest("scriptRevision must match the current project script revision.");
    const previous = await this.repository.loadReview(projectId); const review: StoredMappingReview = { project_id: projectId, mapping_revision: previous.mapping_revision + 1, script_revision: project.script_revision, script_fingerprint: scriptFingerprint(scenes), status: "waiting", approved_at: "", approved_by: "", text_only_confirmed: request.textOnlyConfirmed ?? false, legacy_confirmed: request.legacyConfirmed ?? false, reviewed_scenes: [...(request.reviewedScenes ?? [])] };
    await this.repository.saveReview(projectId, review); return { review: toPublicReview(review) };
  }
  async approveReview(projectId: string, body: unknown): Promise<ApproveProjectAssetMappingReviewResponse> {
    if (!isObject(body) || Object.keys(body).some((key) => !["scriptFingerprint", "approvedBy"].includes(key)) || typeof body.scriptFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.scriptFingerprint) || !(body.approvedBy === undefined || (typeof body.approvedBy === "string" && body.approvedBy.trim().length > 0 && body.approvedBy.length <= 80))) throw invalidMappingRequest("Asset Mapping approval request is invalid.");
    const request = body as unknown as ApproveProjectAssetMappingReviewRequest; const project = await this.repository.project(projectId); const scenes = mappingsScenes(project); const sceneList = scenesFor(project); const currentFingerprint = scriptFingerprint(scenes); const review = await this.repository.loadReview(projectId);
    if (review.script_revision !== project.script_revision || review.script_fingerprint !== currentFingerprint || request.scriptFingerprint !== currentFingerprint) { const invalidated = { ...review, mapping_revision: review.mapping_revision + 1, script_revision: project.script_revision, script_fingerprint: currentFingerprint, status: "waiting" as const, approved_at: "", approved_by: "", reviewed_scenes: [] }; await this.repository.saveReview(projectId, invalidated); throw fingerprintMismatch(); }
    const mappings = (await this.repository.load(projectId)).filter((mapping) => !mapping.candidate_only);
    const blocked = mappings.filter((mapping) => mapping.status === "suggested" || mapping.status === "ambiguous" || mapping.status === "invalid" || (mapping.status === "unmatched" && !mapping.user_confirmed));
    if (blocked.length) throw approvalBlocked("Unconfirmed Asset Mappings must be resolved before approval.", { mappingIds: blocked.map((item) => item.mapping_id) });
    if (!mappings.length && !review.text_only_confirmed && !review.legacy_confirmed) throw approvalBlocked("Text-only or legacy confirmation is required when no Asset Mapping exists.");
    if (mappings.length && !review.legacy_confirmed) {
      const covered = sceneList.filter((number) => mappings.some((mapping) => scopeIncludes(mapping.scene_scope, number) && (mapping.status === "confirmed" || mapping.status === "excluded" || (mapping.status === "unmatched" && mapping.user_confirmed))));
      if (covered.length !== sceneList.length) throw approvalBlocked("Every scene requires a confirmed, excluded, or explicitly unmatched mapping.", { missingSceneNumbers: sceneList.filter((number) => !covered.includes(number)) });
    }
    const approved: StoredMappingReview = { ...review, status: "approved", approved_at: new Date().toISOString(), approved_by: request.approvedBy?.trim() || "user", reviewed_scenes: [...sceneList] };
    await this.repository.saveReview(projectId, approved);
    if (this.projects && project.workflow_state === WorkflowState.WaitingForAssetMappingReview) {
      await this.projects.save({ ...project, workflow_state: WorkflowState.AssetMappingApproved, mapping_revision: approved.mapping_revision, updated_at: new Date().toISOString() });
    }
    return { review: toPublicReview(approved) };
  }
  async snapshot(projectId: string, mappingId: string): Promise<SnapshotProjectAssetMappingResponse> {
    const mappings = await this.repository.load(projectId); const mapping = mappings.find((item) => item.mapping_id === mappingId);
    if (!mapping) return Promise.reject((await import("./mapping-api.error.js")).mappingNotFound());
    const asset = await this.asset(mapping.asset_id); const version = mapping.pinned_version ?? asset.version; const storedVersion = asset.versions.find((item) => item.version === version);
    if (!storedVersion) throw snapshotInvalid();
    const source = this.assets.resolveVersionContentPath(asset, storedVersion.version);
    if (!source) throw snapshotInvalid();
    await this.repository.snapshot(projectId, mapping, source, version); await this.repository.save(projectId, mappings); return { mapping: toPublicMapping(mapping) };
  }
  private async asset(assetId: string) { try { return await this.assets.get(assetId); } catch { throw mappingAssetNotFound(); } }
}
