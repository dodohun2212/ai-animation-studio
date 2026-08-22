import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  API_ROUTES,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type GetProjectResponse,
  type GetProjectSettingsResponse,
  type ListProjectsResponse,
  type UpdateProjectSettingsRequest,
  type UpdateProjectSettingsResponse,
} from "@ai-animation-studio/shared";

import { ProjectsService } from "./projects.service.js";

@Controller()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post(API_ROUTES.projects)
  create(@Body() body: CreateProjectRequest): Promise<CreateProjectResponse> {
    return this.projectsService.createProject(body);
  }

  @Get(API_ROUTES.projects)
  list(): Promise<ListProjectsResponse> {
    return this.projectsService.listProjects();
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
}
