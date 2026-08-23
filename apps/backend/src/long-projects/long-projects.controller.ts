import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { API_ROUTES, type ApproveLongProjectOutlineRequest, type ApproveLongProjectOutlineResponse, type ArchiveProjectRequest, type ArchiveProjectResponse, type CreateLongProjectOutlinePreviewResponse, type CreateLongProjectRequest, type CreateLongProjectResponse, type GetLongProjectResponse, type GetLongProjectSettingsResponse, type ListLongProjectsResponse, type UpdateLongProjectSettingsRequest, type UpdateLongProjectSettingsResponse } from "@ai-animation-studio/shared";
import { LongProjectsService } from "./long-projects.service.js";

@Controller()
export class LongProjectsController {
  constructor(private readonly service: LongProjectsService) {}
  @Post(API_ROUTES.longProjects) create(@Body() body: CreateLongProjectRequest): Promise<CreateLongProjectResponse> { return this.service.create(body); }
  @Get(API_ROUTES.longProjects) list(): Promise<ListLongProjectsResponse> { return this.service.list(); }
  @Get(`${API_ROUTES.longProjects}/:projectId`) get(@Param("projectId") id: string): Promise<GetLongProjectResponse> { return this.service.get(id); }
  @Get(`${API_ROUTES.longProjects}/:projectId/settings`) settings(@Param("projectId") id: string): Promise<GetLongProjectSettingsResponse> { return this.service.getSettings(id); }
  @Patch(`${API_ROUTES.longProjects}/:projectId/settings`) updateSettings(@Param("projectId") id: string, @Body() body: UpdateLongProjectSettingsRequest): Promise<UpdateLongProjectSettingsResponse> { return this.service.updateSettings(id, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/outline/preview`) preview(@Param("projectId") id: string): Promise<CreateLongProjectOutlinePreviewResponse> { return this.service.preview(id); }
  @Post(`${API_ROUTES.longProjects}/:projectId/outline/approval`) approve(@Param("projectId") id: string, @Body() body: ApproveLongProjectOutlineRequest): Promise<ApproveLongProjectOutlineResponse> { return this.service.approve(id, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/archive`) archive(@Param("projectId") id: string, @Body() body: ArchiveProjectRequest): Promise<ArchiveProjectResponse> { return this.service.archive(id, body); }
}
