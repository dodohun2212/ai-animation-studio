import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import {
  API_ROUTES,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type DeleteArchivedProjectRequest,
  type DeleteArchivedProjectResponse,
  type GetPostDraftResponse,
  type GetProjectResponse,
  type GetProjectSettingsResponse,
  type GetShortProjectAssetReferencesResponse,
  type GetShortProjectCastResponse,
  type GetShortProjectContinuityResponse,
  type ListArchivedProjectsResponse,
  type ListProjectsResponse,
  type ListShortProjectContinuityOptionsResponse,
  type PutPostDraftResponse,
  type RestoreProjectResponse,
  type SetShortProjectContinuityResponse,
  type UpdateProjectSettingsRequest,
  type UpdateProjectSettingsResponse,
  type UpdateShortProjectAssetReferencesResponse,
  type UpdateShortProjectCastResponse,
  type ArchiveProjectRequest,
  type ArchiveProjectResponse,
  type UpdateSceneResponse,
} from "@ai-animation-studio/shared";

import { ProjectsService } from "./projects.service.js";
import { SceneEditService } from "./scene-edit.service.js";

@Controller()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService, private readonly sceneEditService: SceneEditService) {}

  @Post(API_ROUTES.projects)
  create(@Body() body: CreateProjectRequest): Promise<CreateProjectResponse> {
    return this.projectsService.createProject(body);
  }

  @Get(API_ROUTES.projects)
  list(): Promise<ListProjectsResponse> {
    return this.projectsService.listProjects();
  }

  @Get(API_ROUTES.projectsArchived)
  listArchived(): Promise<ListArchivedProjectsResponse> {
    return this.projectsService.listArchivedProjects();
  }

  @Get(`${API_ROUTES.projects}/:projectId`)
  getOne(@Param("projectId") projectId: string): Promise<GetProjectResponse> {
    return this.projectsService.getProject(projectId);
  }

  @Get(`${API_ROUTES.projects}/:projectId/settings`)
  getSettings(@Param("projectId") projectId: string): Promise<GetProjectSettingsResponse> {
    return this.projectsService.getProjectSettings(projectId);
  }

  @Patch(`${API_ROUTES.projects}/:projectId/settings`)
  updateSettings(
    @Param("projectId") projectId: string,
    @Body() body: UpdateProjectSettingsRequest,
  ): Promise<UpdateProjectSettingsResponse> {
    return this.projectsService.updateProjectSettings(projectId, body);
  }

  @Get(`${API_ROUTES.projects}/:projectId/settings/cast`)
  getCast(@Param("projectId") projectId: string): Promise<GetShortProjectCastResponse> {
    return this.projectsService.getProjectCast(projectId);
  }

  @Put(`${API_ROUTES.projects}/:projectId/settings/cast`)
  updateCast(@Param("projectId") projectId: string, @Body() body: unknown): Promise<UpdateShortProjectCastResponse> {
    return this.projectsService.updateProjectCast(projectId, body);
  }

  @Get(`${API_ROUTES.projects}/:projectId/settings/asset-references`)
  getAssetReferences(@Param("projectId") projectId: string): Promise<GetShortProjectAssetReferencesResponse> {
    return this.projectsService.getProjectAssetReferences(projectId);
  }

  @Put(`${API_ROUTES.projects}/:projectId/settings/asset-references`)
  updateAssetReferences(@Param("projectId") projectId: string, @Body() body: unknown): Promise<UpdateShortProjectAssetReferencesResponse> {
    return this.projectsService.updateProjectAssetReferences(projectId, body);
  }

  @Get(`${API_ROUTES.projects}/:projectId/post-draft`)
  getPostDraft(@Param("projectId") projectId: string): Promise<GetPostDraftResponse> {
    return this.projectsService.getProjectPostDraft(projectId);
  }

  @Put(`${API_ROUTES.projects}/:projectId/post-draft`)
  updatePostDraft(@Param("projectId") projectId: string, @Body() body: unknown): Promise<PutPostDraftResponse> {
    return this.projectsService.updateProjectPostDraft(projectId, body);
  }

  @Get(`${API_ROUTES.projects}/:projectId/settings/continuity-options`)
  listContinuityOptions(@Param("projectId") projectId: string): Promise<ListShortProjectContinuityOptionsResponse> {
    return this.projectsService.listProjectContinuityOptions(projectId);
  }

  @Get(`${API_ROUTES.projects}/:projectId/settings/continuity`)
  getContinuity(@Param("projectId") projectId: string): Promise<GetShortProjectContinuityResponse> {
    return this.projectsService.getProjectContinuity(projectId);
  }

  @Put(`${API_ROUTES.projects}/:projectId/settings/continuity`)
  updateContinuity(@Param("projectId") projectId: string, @Body() body: unknown): Promise<SetShortProjectContinuityResponse> {
    return this.projectsService.updateProjectContinuity(projectId, body);
  }

  @Post(`${API_ROUTES.projects}/:projectId/archive`)
  archive(@Param("projectId") projectId: string, @Body() body: ArchiveProjectRequest): Promise<ArchiveProjectResponse> {
    return this.projectsService.archiveProject(projectId, body);
  }

  @Post(`${API_ROUTES.projects}/:projectId/restore`)
  restore(@Param("projectId") projectId: string): Promise<RestoreProjectResponse> {
    return this.projectsService.restoreProject(projectId);
  }

  @Delete(`${API_ROUTES.projects}/:projectId/archive`)
  deleteArchived(@Param("projectId") projectId: string, @Body() body: DeleteArchivedProjectRequest): Promise<DeleteArchivedProjectResponse> {
    return this.projectsService.deleteArchivedProject(projectId, body);
  }

  @Patch(`${API_ROUTES.projects}/:projectId/scenes/:sceneNumber`)
  updateScene(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Body() body: unknown): Promise<UpdateSceneResponse> {
    return this.sceneEditService.update(projectId, sceneNumber, body);
  }
}
