import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type { ApproveLongEpisodeAssetMappingReviewRequest, ApproveLongEpisodeAssetMappingReviewResponse, BeginLongEpisodeAssetMappingReviewRequest, BeginLongEpisodeAssetMappingReviewResponse, GetLongEpisodeAssetMappingReviewResponse, GetLongEpisodeAutomaticReferenceSummaryResponse, LongEpisodeAssetMappingCandidate, LongEpisodeAssetMappingReview, LongEpisodeAutomaticReferenceSummary, LongEpisodeDetail, LongEpisodeStatus, RerunLongEpisodeAssetMatchingResponse, SceneNumber, UpdateLongEpisodeAssetMappingRequest, UpdateLongEpisodeAssetMappingResponse } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { longEpisodeMappingNotAllowed, longEpisodeMappingNotFound, longEpisodeMappingStale, longEpisodeMappingUnconfirmed, longEpisodeNotFound, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { toApiEpisodeScript } from "./episode-script-format.js";

type StoredCandidate = { mapping_id: string; source_collection: "basic" | "characters" | "locations" | "props"; source_item_id: string; asset_id: string; usage_role: "character" | "background" | "object" | "style"; version_policy: "pinned_version" | "follow_latest" | "snapshot"; pinned_version: number | null; episode_scope: { mode: "all" } | { mode: "episode"; episode: number }; status: "suggested" | "confirmed" | "excluded"; user_confirmed: boolean; created_at: string; updated_at: string };
type StoredReview = { project_id: string; episode_number: number; mapping_revision: number; script_revision: number; script_fingerprint: string; status: "waiting" | "approved"; text_only_confirmed: boolean; approved_at: string; candidates: StoredCandidate[] };
type StoredEpisode = Record<string, unknown> & { number: number; state: LongEpisodeStatus; approved: boolean; script: Record<string, unknown>; script_revision: number; updated_at: string; scene_count?: number };
const episodeStatuses: readonly LongEpisodeStatus[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted"];
const collections = ["characters", "locations", "props"] as const;
const idKeys = { characters: "character_id", locations: "location_id", props: "prop_id" } as const;
const roleByCollection = { characters: "character", locations: "background", props: "object" } as const;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const fingerprint = (scenes: unknown[]) => crypto.createHash("sha256").update(JSON.stringify(stable(scenes)), "utf8").digest("hex");

@Injectable()
export class EpisodeAssetMappingsService {
  constructor(private readonly projectsRoot: string, private readonly assets: LocalAssetsRepository) {}

  private files(projectId: string, number: number) {
    if (!isSafeProjectId(projectId)) throw longUnsafeId();
    const root = path.join(resolveSafeProjectDirectory(this.projectsRoot, projectId), "long_story"); const episode = path.join(root, `Episode${String(number).padStart(2, "0")}`);
    return { root, bible: path.join(root, "story_bible.json"), outlines: path.join(root, "episode_outlines.json"), episode, project: path.join(episode, "project.json"), mappings: path.join(episode, "asset_mappings.json"), review: path.join(episode, "asset_mapping_review.json") };
  }
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  private number(value: number) { if (!Number.isInteger(value) || value < 1) throw longEpisodeNotFound(); return value; }
  private async episode(projectId: string, number: number): Promise<StoredEpisode> {
    this.number(number); const files = this.files(projectId, number); const outlines = await this.json(files.outlines);
    if (!Array.isArray(outlines) || number > outlines.length || !isObject(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound();
    const raw = await this.json(files.project); if (!isObject(raw) || raw.number !== number || !episodeStatuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !isObject(raw.script) || !Number.isInteger(raw.script_revision) || Number(raw.script_revision) < 1 || typeof raw.updated_at !== "string") throw longInvalidData();
    return raw as StoredEpisode;
  }
  /** Falls back to 6, matching every Episode stored before scene_count existed (see episode-scripts.service.ts's parseStored). */
  private sceneCount(episode: StoredEpisode): number { return Number.isInteger(episode.scene_count) ? episode.scene_count as number : 6; }
  private scenes(episode: StoredEpisode): unknown[] { const scenes = episode.script.scenes; const count = this.sceneCount(episode); if (!Array.isArray(scenes) || scenes.length !== count || scenes.some((scene, index) => !isObject(scene) || scene.number !== index + 1)) throw longInvalidData(); return scenes; }
  private async saveEpisode(projectId: string, number: number, episode: StoredEpisode) { try { await atomicWriteUtf8File(this.files(projectId, number).project, JSON.stringify(episode, null, 2)); } catch { throw longStorageError(); } }
  private candidate(value: unknown): StoredCandidate {
    if (!isObject(value) || Object.keys(value).some((key) => !["mapping_id", "source_collection", "source_item_id", "asset_id", "usage_role", "version_policy", "pinned_version", "episode_scope", "status", "user_confirmed", "created_at", "updated_at"].includes(key))
      || typeof value.mapping_id !== "string" || typeof value.source_item_id !== "string" || typeof value.asset_id !== "string" || !["basic", ...collections].includes(value.source_collection as string)
      || !["character", "background", "object", "style"].includes(value.usage_role as string) || !["pinned_version", "follow_latest", "snapshot"].includes(value.version_policy as string) || !(value.pinned_version === null || (Number.isInteger(value.pinned_version) && Number(value.pinned_version) >= 1))
      || !["suggested", "confirmed", "excluded"].includes(value.status as string) || typeof value.user_confirmed !== "boolean" || typeof value.created_at !== "string" || typeof value.updated_at !== "string" || !isObject(value.episode_scope)) throw longInvalidData();
    const scope = value.episode_scope;
    if (!((scope.mode === "all" && Object.keys(scope).length === 1) || (scope.mode === "episode" && Object.keys(scope).length === 2 && Number.isInteger(scope.episode) && Number(scope.episode) >= 1))) throw longInvalidData();
    if ((value.version_policy === "pinned_version") !== (value.pinned_version !== null)) throw longInvalidData();
    return value as StoredCandidate;
  }
  private review(value: unknown, projectId: string, number: number): StoredReview {
    if (!isObject(value) || Object.keys(value).some((key) => !["project_id", "episode_number", "mapping_revision", "script_revision", "script_fingerprint", "status", "text_only_confirmed", "approved_at", "candidates"].includes(key))
      || value.project_id !== projectId || value.episode_number !== number || !Number.isInteger(value.mapping_revision) || Number(value.mapping_revision) < 1 || !Number.isInteger(value.script_revision) || Number(value.script_revision) < 1
      || typeof value.script_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.script_fingerprint) || !["waiting", "approved"].includes(value.status as string) || typeof value.text_only_confirmed !== "boolean" || typeof value.approved_at !== "string" || !Array.isArray(value.candidates)) throw longInvalidData();
    const candidates = value.candidates.map((item) => this.candidate(item)); if (new Set(candidates.map((item) => item.mapping_id)).size !== candidates.length) throw longInvalidData();
    return { ...(value as Omit<StoredReview, "candidates">), candidates };
  }
  private emptyReview(projectId: string, number: number): LongEpisodeAssetMappingReview { return { projectId, episodeNumber: number, mappingRevision: 0, scriptRevision: 0, scriptFingerprint: "0".repeat(64), status: "waiting", textOnlyConfirmed: false, candidates: [] }; }
  private async loadReview(projectId: string, number: number): Promise<StoredReview> { return this.review(await this.json(this.files(projectId, number).review), projectId, number); }
  private async saveReview(projectId: string, number: number, review: StoredReview) { try { await atomicWriteUtf8File(this.files(projectId, number).review, JSON.stringify(review, null, 2)); await atomicWriteUtf8File(this.files(projectId, number).mappings, JSON.stringify(review.candidates, null, 2)); } catch { throw longStorageError(); } }
  private api(candidate: StoredCandidate): LongEpisodeAssetMappingCandidate { return { mappingId: candidate.mapping_id, sourceCollection: candidate.source_collection, sourceItemId: candidate.source_item_id, assetId: candidate.asset_id, usageRole: candidate.usage_role, versionPolicy: candidate.version_policy, pinnedVersion: candidate.pinned_version, episodeScope: candidate.episode_scope, status: candidate.status, userConfirmed: candidate.user_confirmed }; }
  private inScope(candidate: StoredCandidate, number: number) { return candidate.episode_scope.mode === "all" || candidate.episode_scope.episode === number; }
  private public(review: StoredReview): LongEpisodeAssetMappingReview { return { projectId: review.project_id, episodeNumber: review.episode_number, mappingRevision: review.mapping_revision, scriptRevision: review.script_revision, scriptFingerprint: review.script_fingerprint, status: review.status, textOnlyConfirmed: review.text_only_confirmed, candidates: review.candidates.map((candidate) => this.api(candidate)) }; }
  private async automaticSummary(projectId: string, number: number, candidates: StoredCandidate[], scenes: unknown[]): Promise<LongEpisodeAutomaticReferenceSummary> {
    const assetIds = [...new Set(candidates.filter((candidate) => candidate.status !== "excluded" && this.inScope(candidate, number)).map((candidate) => candidate.asset_id))].sort();
    const terms = new Map<string, string[]>();
    for (const assetId of assetIds) {
      let asset; try { asset = await this.assets.get(assetId); } catch { throw longInvalidData(); }
      terms.set(assetId, [asset.display_name, asset.character_key ?? "", ...asset.aliases, ...asset.tags].map((value) => value.trim().toLocaleLowerCase()).filter((value) => value.length >= 2));
    }
    const selectedAssetIdsByScene = {} as Record<SceneNumber, string[]>;
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index]; if (!isObject(scene) || scene.number !== index + 1) throw longInvalidData();
      const content = JSON.stringify(scene).toLocaleLowerCase();
      selectedAssetIdsByScene[(index + 1) as SceneNumber] = assetIds.filter((assetId) => {
        const candidate = candidates.find((item) => item.asset_id === assetId && item.usage_role === "style" && item.status !== "excluded");
        return Boolean(candidate) || (terms.get(assetId) ?? []).some((term) => content.includes(term));
      });
    }
    return { candidateAssetIds: assetIds, selectedAssetIdsByScene, estimatedImageApiCalls: scenes.length };
  }
  private async bibleCandidates(projectId: string, number: number): Promise<StoredCandidate[]> {
    const bible = await this.json(this.files(projectId, number).bible); if (!isObject(bible)) throw longInvalidData(); const result: StoredCandidate[] = []; const now = new Date().toISOString();
    for (const collection of collections) {
      if (!Array.isArray(bible[collection])) throw longInvalidData();
      for (const item of bible[collection]) {
        if (!isObject(item)) throw longInvalidData(); const sourceItemId = item[idKeys[collection]]; const link = item.asset_link;
        if (link === undefined) continue; if (typeof sourceItemId !== "string" || !isObject(link) || typeof link.asset_id !== "string" || !["pinned_version", "follow_latest"].includes(link.version_policy as string) || !(link.pinned_version === null || (Number.isInteger(link.pinned_version) && Number(link.pinned_version) >= 1)) || !isObject(link.episode_scope)) throw longInvalidData();
        const scope = link.episode_scope; const inScope = scope.mode === "all" || (scope.mode === "episode" && scope.episode === number); if (!inScope) continue;
        if (!((scope.mode === "all" && Object.keys(scope).length === 1) || (scope.mode === "episode" && Object.keys(scope).length === 2 && Number.isInteger(scope.episode)))) throw longInvalidData();
        let asset; try { asset = await this.assets.get(link.asset_id); } catch { throw longInvalidData(); }
        if (asset.is_folder || !asset.enabled || !asset.approved || asset.asset_type !== roleByCollection[collection] || (link.version_policy === "pinned_version" && !asset.versions.some((version) => version.version === link.pinned_version))) throw longInvalidData();
        result.push({ mapping_id: `EP-MAP-${crypto.randomBytes(8).toString("hex").toUpperCase()}`, source_collection: collection, source_item_id: sourceItemId, asset_id: link.asset_id, usage_role: roleByCollection[collection], version_policy: link.version_policy as StoredCandidate["version_policy"], pinned_version: link.pinned_version as number | null, episode_scope: scope.mode === "all" ? { mode: "all" } : { mode: "episode", episode: scope.episode as number }, status: "suggested", user_confirmed: false, created_at: now, updated_at: now });
      }
    }
    const style = isObject(bible.basic) ? bible.basic.style_asset_link : undefined;
    if (style !== undefined) {
      if (!isObject(style) || Object.keys(style).length !== 3 || typeof style.asset_id !== "string" || !["pinned_version", "follow_latest", "snapshot"].includes(style.version_policy as string) || !Number.isInteger(style.pinned_version) || Number(style.pinned_version) < 1) throw longInvalidData();
      let asset; try { asset = await this.assets.get(style.asset_id); } catch { throw longInvalidData(); }
      if (asset.is_folder || !asset.enabled || !asset.approved || asset.asset_type !== "style" || !asset.versions.some((version) => version.version === style.pinned_version)) throw longInvalidData();
      result.push({ mapping_id: `EP-MAP-${crypto.randomBytes(8).toString("hex").toUpperCase()}`, source_collection: "basic", source_item_id: "style_asset_link", asset_id: style.asset_id, usage_role: "style", version_policy: style.version_policy as StoredCandidate["version_policy"], pinned_version: style.pinned_version as number, episode_scope: { mode: "episode", episode: number }, status: "suggested", user_confirmed: false, created_at: now, updated_at: now });
    }
    return result;
  }
  private detail(episode: StoredEpisode): LongEpisodeDetail { const script = toApiEpisodeScript(episode.script); return { episodeNumber: episode.number, title: String(episode.title), summary: String(episode.summary), mainEvent: String(episode.core_event), conflict: String(episode.conflict), cliffhanger: String(episode.cliffhanger), nextEpisodeHook: String(episode.next_connection), status: episode.state, approved: episode.approved, scriptRevision: episode.script_revision, ...(script ? { script } : {}), scriptHistoryCount: Array.isArray(episode.script_history) ? episode.script_history.length : 0 }; }

  async get(projectId: string, number: number): Promise<GetLongEpisodeAssetMappingReviewResponse> {
    const id = projectId.trim(); await this.episode(id, number);
    try { return { review: this.public(await this.loadReview(id, number)) }; } catch (error) {
      if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) return { review: this.emptyReview(id, number) };
      throw error;
    }
  }
  async automaticReferenceSummary(projectId: string, number: number): Promise<GetLongEpisodeAutomaticReferenceSummaryResponse> {
    const id = projectId.trim(); const episode = await this.episode(id, number);
    if (episode.state !== "waiting_for_asset_mapping_review" && episode.state !== "asset_mapping_approved") throw longEpisodeMappingNotAllowed();
    const review = await this.loadReview(id, number);
    return { summary: await this.automaticSummary(id, number, review.candidates, this.scenes(episode)) };
  }
  async begin(projectId: string, number: number, request: BeginLongEpisodeAssetMappingReviewRequest): Promise<BeginLongEpisodeAssetMappingReviewResponse> {
    const id = projectId.trim(); if (!isObject(request ?? {}) || Object.keys(request ?? {}).some((key) => key !== "textOnlyConfirmed") || !(request?.textOnlyConfirmed === undefined || typeof request.textOnlyConfirmed === "boolean")) throw longInvalidRequest("Episode Asset Mapping review request is invalid.");
    const episode = await this.episode(id, number);
    if (episode.state === "waiting_for_asset_mapping_review" && request?.textOnlyConfirmed === true) {
      // Re-confirming the already-started, candidate-less review (the Frontend's second "Confirm text-only review" click) — not a fresh review, so keep the existing revision/candidates untouched.
      const existing = await this.loadReview(id, number); if (existing.candidates.length > 0) throw longEpisodeMappingNotAllowed();
      existing.text_only_confirmed = true; await this.saveReview(id, number, existing); return { review: this.public(existing) };
    }
    if (episode.state !== "script_approved" || !episode.approved) throw longEpisodeMappingNotAllowed(); const scenes = this.scenes(episode); const candidates = await this.bibleCandidates(id, number);
    const review: StoredReview = { project_id: id, episode_number: number, mapping_revision: 1, script_revision: episode.script_revision, script_fingerprint: fingerprint(scenes), status: "waiting", text_only_confirmed: request?.textOnlyConfirmed ?? false, approved_at: "", candidates };
    episode.state = "waiting_for_asset_mapping_review"; episode.updated_at = new Date().toISOString(); await this.saveReview(id, number, review); await this.saveEpisode(id, number, episode); return { review: this.public(review) };
  }
  async update(projectId: string, number: number, mappingId: string, request: UpdateLongEpisodeAssetMappingRequest): Promise<UpdateLongEpisodeAssetMappingResponse> {
    const id = projectId.trim(); if (!isObject(request) || Object.keys(request).length !== 1 || !(request.decision === "confirm" || request.decision === "exclude")) throw longInvalidRequest("Episode Asset Mapping update is invalid.");
    const episode = await this.episode(id, number); if (episode.state !== "waiting_for_asset_mapping_review") throw longEpisodeMappingNotAllowed(); const review = await this.loadReview(id, number); const candidate = review.candidates.find((item) => item.mapping_id === mappingId); if (!candidate) throw longEpisodeMappingNotFound(); if (!this.inScope(candidate, number)) throw longInvalidRequest("Episode Asset Mapping is outside this Episode scope.");
    if (review.script_revision !== episode.script_revision || review.script_fingerprint !== fingerprint(this.scenes(episode))) throw longEpisodeMappingStale();
    candidate.status = request.decision === "confirm" ? "confirmed" : "excluded"; candidate.user_confirmed = true; candidate.updated_at = new Date().toISOString(); review.mapping_revision += 1; await this.saveReview(id, number, review); return { mapping: this.api(candidate), review: this.public(review) };
  }
  async approve(projectId: string, number: number, request: ApproveLongEpisodeAssetMappingReviewRequest): Promise<ApproveLongEpisodeAssetMappingReviewResponse> {
    const id = projectId.trim(); if (!isObject(request) || Object.keys(request).some((key) => !["approved", "scriptFingerprint"].includes(key)) || request.approved !== true || typeof request.scriptFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(request.scriptFingerprint)) throw longInvalidRequest("Episode Asset Mapping approval request is invalid.");
    const episode = await this.episode(id, number); if (episode.state !== "waiting_for_asset_mapping_review") throw longEpisodeMappingNotAllowed(); const review = await this.loadReview(id, number); const current = fingerprint(this.scenes(episode));
    if (review.script_revision !== episode.script_revision || review.script_fingerprint !== current || request.scriptFingerprint !== current) throw longEpisodeMappingStale();
    if (review.candidates.some((candidate) => !this.inScope(candidate, number))) throw longInvalidRequest("Episode Asset Mapping is outside this Episode scope.");
    if (review.candidates.some((candidate) => !candidate.user_confirmed || candidate.status === "suggested")) throw longEpisodeMappingUnconfirmed();
    if (!review.candidates.length && !review.text_only_confirmed) throw longEpisodeMappingUnconfirmed();
    review.status = "approved"; review.approved_at = new Date().toISOString(); episode.state = "asset_mapping_approved"; episode.mapping_revision = review.mapping_revision; episode.updated_at = new Date().toISOString(); await this.saveReview(id, number, review); await this.saveEpisode(id, number, episode); return { review: this.public(review), episode: this.detail(episode) };
  }
  async rerun(projectId: string, number: number): Promise<RerunLongEpisodeAssetMatchingResponse> {
    const id = projectId.trim(); const episode = await this.episode(id, number);
    if (episode.state !== "waiting_for_asset_mapping_review" && episode.state !== "asset_mapping_approved") throw longEpisodeMappingNotAllowed();
    let previousRevision = 0;
    try { previousRevision = (await this.loadReview(id, number)).mapping_revision; } catch (error) { if (!(error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404)) throw error; }
    const scenes = this.scenes(episode); const review: StoredReview = { project_id: id, episode_number: number, mapping_revision: previousRevision + 1, script_revision: episode.script_revision, script_fingerprint: fingerprint(scenes), status: "waiting", text_only_confirmed: false, approved_at: "", candidates: await this.bibleCandidates(id, number) };
    episode.state = "waiting_for_asset_mapping_review"; episode.mapping_revision = review.mapping_revision; episode.updated_at = new Date().toISOString();
    await this.saveReview(id, number, review); await this.saveEpisode(id, number, episode);
    return { review: this.public(review), episode: this.detail(episode) };
  }
}
