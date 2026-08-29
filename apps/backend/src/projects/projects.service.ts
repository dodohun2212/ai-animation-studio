import { Injectable } from "@nestjs/common";
import { WorkflowState } from "@ai-animation-studio/shared";
import type {
  ArchiveProjectRequest,
  ArchiveProjectResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  DeleteArchivedProjectRequest,
  DeleteArchivedProjectResponse,
  GetPostDraftResponse,
  GetProjectResponse,
  GetProjectSettingsResponse,
  GetShortProjectAssetReferencesResponse,
  GetShortProjectCastResponse,
  GetShortProjectContinuityResponse,
  ListArchivedProjectsResponse,
  ListProjectsResponse,
  ListShortProjectContinuityOptionsResponse,
  PutPostDraftResponse,
  RestoreProjectResponse,
  SetShortProjectContinuityRequest,
  SetShortProjectContinuityResponse,
  UpdateProjectSettingsRequest,
  UpdateProjectSettingsResponse,
  UpdateShortProjectAssetReferencesRequest,
  UpdateShortProjectAssetReferencesResponse,
  UpdateShortProjectCastRequest,
  UpdateShortProjectCastResponse,
} from "@ai-animation-studio/shared";

import { shortProjectAspectRatio } from "./project-aspect.js";
import { aspectRatioLocked, sceneCountLocked, invalidRequest, projectArchiveCollision, projectArchiveNotAllowed, projectNotFound, projectRestoreCollision, storageError } from "./project-api.error.js";
import { createStoredProject, toApiProject, toApiSummary } from "./project.mapper.js";
import { applyShortProjectAssetReferences, parseShortProjectAssetReferences, toShortProjectAssetReferences } from "./project-asset-references.js";
import { applyPostDraft, parsePostDraft, toPostDraft } from "./project-post-draft.js";
import { applyShortProjectCast, parseShortProjectCast, toShortProjectCast } from "./project-cast.js";
import { applyContinuityCandidate, listContinuityOptions, resolveContinuityCandidate, toShortProjectContinuityLink } from "./project-continuity.js";
import { applyShortProjectSettings, parseShortProjectSettings, toShortProjectSettings } from "./project-settings.js";
import { LocalProjectRepository } from "./projects.repository.js";
import type { LocalAssetsRepository } from "../assets/assets.repository.js";
import type { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { syncAutoMappings } from "./project-asset-mapping-sync.js";

const ATMOSPHERE_ASSET_TYPES = new Set(["style", "general_reference", "background"]);
const SCENE_REFERENCE_ASSET_TYPES = new Set(["background", "object", "style", "general_reference"]);

function requireNonEmptyTrimmed(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw invalidRequest(`${field} must be a string.`, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw invalidRequest(`${field} must not be empty.`, { field });
  }
  return trimmed;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly repository: LocalProjectRepository,
    private readonly assets?: LocalAssetsRepository,
    private readonly mappings?: LocalProjectAssetMappingsRepository,
  ) {}

  async createProject(request: CreateProjectRequest): Promise<CreateProjectResponse> {
    const projectId = requireNonEmptyTrimmed(request?.projectId, "projectId");
    const topic = requireNonEmptyTrimmed(request?.topic, "topic");
    const timestamp = new Date().toISOString();
    const stored = createStoredProject(projectId, topic, timestamp);
    await this.repository.create(stored);
    return { project: toApiProject(stored) };
  }

  async listProjects(): Promise<ListProjectsResponse> {
    const stored = await this.repository.list();
    const sorted = [...stored].sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
    );
    return { projects: sorted.map(toApiSummary) };
  }

  async getProject(projectId: string): Promise<GetProjectResponse> {
    const trimmed = typeof projectId === "string" ? projectId.trim() : "";
    const stored = await this.repository.findById(trimmed);
    return { project: toApiProject(stored) };
  }

  async archiveProject(projectId: string, request: ArchiveProjectRequest): Promise<ArchiveProjectResponse> {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    const project = await this.repository.findById(id);
    if (!request || Object.keys(request).length !== 1 || typeof request.confirmation !== "string"
      || !request.confirmation.trim() || request.confirmation !== project.topic) {
      throw invalidRequest("Archive confirmation must exactly match the project topic.", { field: "confirmation" });
    }
    if ([WorkflowState.GeneratingStory, WorkflowState.GeneratingImages, WorkflowState.GeneratingVideos, WorkflowState.Rendering, WorkflowState.Interrupted].includes(project.workflow_state as WorkflowState)) {
      throw projectArchiveNotAllowed();
    }
    try {
      await this.repository.archive(id);
    } catch (error) {
      if (error instanceof Error && error.message === "archive destination already exists") throw projectArchiveCollision();
      throw storageError(`Failed to archive project "${id}".`);
    }
    return { archivedProjectId: id };
  }

  async listArchivedProjects(): Promise<ListArchivedProjectsResponse> {
    const entries = await this.repository.listArchived();
    const sorted = [...entries].sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt));
    return { projects: sorted.map(({ project, archivedAt }) => ({ ...toApiSummary(project), archivedAt })) };
  }

  async restoreProject(projectId: string): Promise<RestoreProjectResponse> {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    try {
      await this.repository.restore(id);
    } catch (error) {
      if (error instanceof Error && error.message === "archived project not found") throw projectNotFound(id);
      if (error instanceof Error && error.message === "restore destination already exists") throw projectRestoreCollision();
      if (error && typeof error === "object" && "getStatus" in error) throw error;
      throw storageError(`Failed to restore project "${id}".`);
    }
    return { restoredProjectId: id };
  }

  async deleteArchivedProject(projectId: string, request: DeleteArchivedProjectRequest): Promise<DeleteArchivedProjectResponse> {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    const archived = await this.repository.findArchivedById(id);
    if (!request || Object.keys(request).length !== 1 || typeof request.confirmation !== "string"
      || !request.confirmation.trim() || request.confirmation !== archived.topic) {
      throw invalidRequest("Delete confirmation must exactly match the project topic.", { field: "confirmation" });
    }
    try {
      await this.repository.deleteArchived(id);
    } catch (error) {
      if (error && typeof error === "object" && "getStatus" in error) throw error;
      throw storageError(`Failed to delete archived project "${id}".`);
    }
    return { deletedProjectId: id };
  }

  async getProjectSettings(projectId: string): Promise<GetProjectSettingsResponse> {
    const stored = await this.repository.findById(projectId.trim());
    // Read from the same two facts updateProjectSettings refuses on, so the screen and the save cannot disagree.
    return {
      settings: toShortProjectSettings(stored),
      sceneCountChangeable: stored.scenes.length === 0,
      aspectRatioChangeable: stored.generated_images.length === 0,
    };
  }

  async updateProjectSettings(
    projectId: string,
    request: UpdateProjectSettingsRequest,
  ): Promise<UpdateProjectSettingsResponse> {
    const stored = await this.repository.findById(projectId.trim());
    const settings = parseShortProjectSettings(request?.settings);
    // Everything else on this form stays editable with a Story in place — the name, the topic, the notes. Only
    // the scene count is refused, and only when it would actually change, because that is the one the rest of
    // the pipeline counts from while the Story counts from its own scenes.
    const storyScenes = stored.scenes.length;
    if (storyScenes > 0 && settings.sceneCount !== toShortProjectSettings(stored).sceneCount) throw sceneCountLocked(storyScenes);
    const updated = applyShortProjectSettings(stored, settings, new Date().toISOString());
    // Compared through the one function that reads orientation from storage, rather than by looking at the
    // request's own text: that function is where "16 : 9" and "16:9" are decided to be the same thing, and a
    // second reading here would be the sixth copy of a derivation that already caused this exact bug once.
    if (stored.generated_images.length > 0 && shortProjectAspectRatio(updated) !== shortProjectAspectRatio(stored)) throw aspectRatioLocked();
    await this.repository.save(updated);
    return { project: toApiProject(updated), settings };
  }

  async getProjectCast(projectId: string): Promise<GetShortProjectCastResponse> {
    const stored = await this.repository.findById(projectId.trim());
    return { cast: toShortProjectCast(stored) };
  }

  async updateProjectCast(projectId: string, request: unknown): Promise<UpdateShortProjectCastResponse> {
    const stored = await this.repository.findById(projectId.trim());
    const cast = parseShortProjectCast(request as UpdateShortProjectCastRequest);
    if (this.assets) {
      for (const member of cast) {
        let asset;
        try { asset = await this.assets.get(member.assetId); } catch { throw invalidRequest(`Character Asset "${member.assetId}" was not found.`, { field: "assetId" }); }
        // The cast search screen only ever offers Folders (a loose image is one drawing of a character, not the
        // character — see ShortProjectSettingsScreen's search()), and describeCharacterCast() already resolves a
        // Folder's own description plus each child's individual one for the prompt. A Folder is the expected
        // shape here, not an exception to reject.
        if (asset.asset_type !== "character") {
          throw invalidRequest(`Asset "${member.assetId}" must be a character Asset.`, { field: "assetId" });
        }
      }
    }
    const updated = applyShortProjectCast(stored, cast, new Date().toISOString());
    await this.repository.save(updated);
    if (this.assets && this.mappings) {
      await syncAutoMappings(this.mappings, this.assets, this.mappings.projectLocation(updated.project_id), "auto_cast", cast.map((member) => ({ assetId: member.assetId, usageRole: "character" })));
    }
    return { cast };
  }

  async getProjectAssetReferences(projectId: string): Promise<GetShortProjectAssetReferencesResponse> {
    const stored = await this.repository.findById(projectId.trim());
    return toShortProjectAssetReferences(stored);
  }

  async updateProjectAssetReferences(projectId: string, request: unknown): Promise<UpdateShortProjectAssetReferencesResponse> {
    const stored = await this.repository.findById(projectId.trim());
    const references = parseShortProjectAssetReferences(request as UpdateShortProjectAssetReferencesRequest);
    if (this.assets) {
      for (const assetId of references.atmosphereAssetIds) {
        let asset;
        try { asset = await this.assets.get(assetId); } catch { throw invalidRequest(`Asset "${assetId}" was not found.`, { field: "atmosphereAssetIds" }); }
        if (asset.is_folder || !ATMOSPHERE_ASSET_TYPES.has(asset.asset_type)) {
          throw invalidRequest(`Asset "${assetId}" must be a non-folder style, background or general reference Asset.`, { field: "atmosphereAssetIds" });
        }
      }
      for (const member of references.sceneReferenceAssets) {
        let asset;
        try { asset = await this.assets.get(member.assetId); } catch { throw invalidRequest(`Asset "${member.assetId}" was not found.`, { field: "sceneReferenceAssets" }); }
        if (asset.is_folder || !SCENE_REFERENCE_ASSET_TYPES.has(asset.asset_type)) {
          throw invalidRequest(`Asset "${member.assetId}" must be a non-folder background, object, style or general reference Asset.`, { field: "sceneReferenceAssets" });
        }
      }
    }
    const updated = applyShortProjectAssetReferences(stored, references, new Date().toISOString());
    await this.repository.save(updated);
    if (this.assets && this.mappings) {
      await syncAutoMappings(this.mappings, this.assets, this.mappings.projectLocation(updated.project_id), "auto_atmosphere", references.atmosphereAssetIds.map((assetId) => ({ assetId, usageRole: "atmosphere" })));
      await syncAutoMappings(this.mappings, this.assets, this.mappings.projectLocation(updated.project_id), "auto_scene_reference", references.sceneReferenceAssets.map((member) => ({ assetId: member.assetId, usageRole: member.purpose })));
    }
    return references;
  }

  async getProjectPostDraft(projectId: string): Promise<GetPostDraftResponse> {
    const stored = await this.repository.findById(projectId.trim());
    return toPostDraft(stored);
  }

  async updateProjectPostDraft(projectId: string, request: unknown): Promise<PutPostDraftResponse> {
    const stored = await this.repository.findById(projectId.trim());
    const draft = parsePostDraft(request);
    const updated = applyPostDraft(stored, draft, new Date().toISOString());
    await this.repository.save(updated);
    return draft;
  }

  async listProjectContinuityOptions(projectId: string): Promise<ListShortProjectContinuityOptionsResponse> {
    const id = projectId.trim();
    await this.repository.findById(id);
    return { options: await listContinuityOptions(this.repository, id) };
  }

  async getProjectContinuity(projectId: string): Promise<GetShortProjectContinuityResponse> {
    const stored = await this.repository.findById(projectId.trim());
    return { link: toShortProjectContinuityLink(stored) };
  }

  async updateProjectContinuity(projectId: string, request: unknown): Promise<SetShortProjectContinuityResponse> {
    const id = projectId.trim();
    const stored = await this.repository.findById(id);
    if (typeof request !== "object" || request === null || Array.isArray(request)
      || Object.keys(request).length !== 1 || !("projectId" in request)
      || (typeof (request as SetShortProjectContinuityRequest).projectId !== "string" && (request as SetShortProjectContinuityRequest).projectId !== null)) {
      throw invalidRequest("Request body must contain only a projectId string or null.", { field: "projectId" });
    }
    const sourceProjectId = (request as SetShortProjectContinuityRequest).projectId;
    if (sourceProjectId === null) {
      const updated = applyContinuityCandidate(stored, null, new Date().toISOString());
      await this.repository.save(updated);
      return { link: null };
    }
    const trimmedSourceId = sourceProjectId.trim();
    if (!trimmedSourceId) throw invalidRequest("projectId must not be empty.", { field: "projectId" });
    const candidate = await resolveContinuityCandidate(this.repository, id, trimmedSourceId);
    if (!candidate) throw invalidRequest(`Project "${trimmedSourceId}" is not eligible for continuity linking.`, { field: "projectId" });
    const updated = applyContinuityCandidate(stored, candidate, new Date().toISOString());
    await this.repository.save(updated);
    return { link: { projectId: candidate.projectId, projectName: candidate.projectName, label: candidate.label } };
  }
}
