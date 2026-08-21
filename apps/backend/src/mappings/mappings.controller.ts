import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { API_ROUTES, type ApproveProjectAssetMappingReviewResponse, type BeginProjectAssetMappingReviewResponse, type GetProjectAssetMappingReviewResponse, type BeginProjectAssetMappingReviewRequest, type CreateProjectAssetMappingResponse, type ListProjectAssetMappingsResponse, type SnapshotProjectAssetMappingResponse, type UpdateProjectAssetMappingResponse } from "@ai-animation-studio/shared";
import { ProjectAssetMappingsService } from "./mappings.service.js";

@Controller()
export class ProjectAssetMappingsController {
  constructor(private readonly service: ProjectAssetMappingsService) {}
  @Get(`${API_ROUTES.projects}/:projectId/assets/mappings`) list(@Param("projectId") projectId: string): Promise<ListProjectAssetMappingsResponse> { return this.service.list(projectId); }
  @Post(`${API_ROUTES.projects}/:projectId/assets/mappings`) create(@Param("projectId") projectId: string, @Body() body: unknown): Promise<CreateProjectAssetMappingResponse> { return this.service.create(projectId, body); }
  @Patch(`${API_ROUTES.projects}/:projectId/assets/mappings/:mappingId`) update(@Param("projectId") projectId: string, @Param("mappingId") mappingId: string, @Body() body: unknown): Promise<UpdateProjectAssetMappingResponse> { return this.service.update(projectId, mappingId, body); }
  @Get(`${API_ROUTES.projects}/:projectId/assets/mapping-review`) review(@Param("projectId") projectId: string): Promise<GetProjectAssetMappingReviewResponse> { return this.service.review(projectId); }
  @Post(`${API_ROUTES.projects}/:projectId/assets/mapping-review`) begin(@Param("projectId") projectId: string, @Body() body: BeginProjectAssetMappingReviewRequest): Promise<BeginProjectAssetMappingReviewResponse> { return this.service.beginReview(projectId, body); }
  @Post(`${API_ROUTES.projects}/:projectId/assets/mapping-review/approve`) approve(@Param("projectId") projectId: string, @Body() body: unknown): Promise<ApproveProjectAssetMappingReviewResponse> { return this.service.approveReview(projectId, body); }
  @Post(`${API_ROUTES.projects}/:projectId/assets/mappings/:mappingId/snapshot`) snapshot(@Param("projectId") projectId: string, @Param("mappingId") mappingId: string): Promise<SnapshotProjectAssetMappingResponse> { return this.service.snapshot(projectId, mappingId); }
}
