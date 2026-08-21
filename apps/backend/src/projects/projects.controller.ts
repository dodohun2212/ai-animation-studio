import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  API_ROUTES,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type GetProjectResponse,
  type ListProjectsResponse,
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
}
