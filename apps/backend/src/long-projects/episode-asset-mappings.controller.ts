import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { API_ROUTES, type ApproveLongEpisodeAssetMappingReviewRequest, type ApproveLongEpisodeAssetMappingReviewResponse, type BeginLongEpisodeAssetMappingReviewRequest, type BeginLongEpisodeAssetMappingReviewResponse, type GetLongEpisodeAssetMappingReviewResponse, type GetLongEpisodeAutomaticReferenceSummaryResponse, type RerunLongEpisodeAssetMatchingResponse, type UpdateLongEpisodeAssetMappingRequest, type UpdateLongEpisodeAssetMappingResponse } from "@ai-animation-studio/shared";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";

@Controller()
export class EpisodeAssetMappingsController {
  constructor(private readonly service: EpisodeAssetMappingsService) {}
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/asset-mapping-review`) get(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeAssetMappingReviewResponse> { return this.service.get(id, Number(number)); }
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/asset-mapping-review/automatic-selection`) automaticSummary(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeAutomaticReferenceSummaryResponse> { return this.service.automaticReferenceSummary(id, Number(number)); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/asset-mapping-review`) begin(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: BeginLongEpisodeAssetMappingReviewRequest): Promise<BeginLongEpisodeAssetMappingReviewResponse> { return this.service.begin(id, Number(number), body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/asset-mapping-review/rerun`) rerun(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<RerunLongEpisodeAssetMatchingResponse> { return this.service.rerun(id, Number(number)); }
  @Patch(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/asset-mapping-review/mappings/:mappingId`) update(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("mappingId") mappingId: string, @Body() body: UpdateLongEpisodeAssetMappingRequest): Promise<UpdateLongEpisodeAssetMappingResponse> { return this.service.update(id, Number(number), mappingId, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/asset-mapping-review/approval`) approve(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: ApproveLongEpisodeAssetMappingReviewRequest): Promise<ApproveLongEpisodeAssetMappingReviewResponse> { return this.service.approve(id, Number(number), body); }
}
