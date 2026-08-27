import { Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import {
  API_ROUTES,
  type ApproveProjectAssetMappingReviewResponse, type BeginProjectAssetMappingReviewRequest,
  type BeginProjectAssetMappingReviewResponse, type CreateProjectAssetMappingResponse,
  type GetProjectAssetMappingReviewResponse, type ListProjectAssetMappingsResponse,
  type SnapshotProjectAssetMappingResponse, type UpdateProjectAssetMappingResponse,
} from "@ai-animation-studio/shared";

import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import type { EpisodeMappingKey } from "./episode-mapping-owner.js";

/**
 * An explicit token, not the service class.
 *
 * ProjectAssetMappingsService is already provided elsewhere, bound to short projects. Registering a second
 * binding under the same class token would work only by module scoping — and would quietly switch to the short
 * one the day this controller moved, with nothing failing to say so. A token names which binding is meant.
 */
export const EPISODE_ASSET_MAPPINGS = Symbol("EPISODE_ASSET_MAPPINGS");

/**
 * One Episode's asset mappings, over the short project's flow.
 *
 * A line-for-line counterpart of ProjectAssetMappingsController, and that is the point rather than an
 * accident: same requests, same responses, same service. The only thing an Episode changes is which scope the
 * URL names, so anything that differed here would be a difference nobody asked for.
 *
 * The Episode's own controller had a narrower set — no create at all, and updates limited to confirm or
 * exclude. Keeping that shape while replacing the implementation underneath would have left linking by hand,
 * Folders and scene-level scope working and unreachable, which is the same trade as fixing something and
 * leaving the screen unable to say so.
 */
@Controller()
export class EpisodeAssetMappingsFlowController {
  constructor(@Inject(EPISODE_ASSET_MAPPINGS) private readonly service: ProjectAssetMappingsService<EpisodeMappingKey>) {}

  /** Parsed here so every route below names an Episode the same way; the service validates the number itself. */
  private key(projectId: string, episodeNumber: string): EpisodeMappingKey {
    return { projectId, episodeNumber: Number(episodeNumber) };
  }

  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/assets/mappings`)
  list(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string): Promise<ListProjectAssetMappingsResponse> {
    return this.service.list(this.key(projectId, episodeNumber));
  }

  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/assets/mappings`)
  create(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string, @Body() body: unknown): Promise<CreateProjectAssetMappingResponse> {
    return this.service.create(this.key(projectId, episodeNumber), body);
  }

  @Patch(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/assets/mappings/:mappingId`)
  update(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string, @Param("mappingId") mappingId: string, @Body() body: unknown): Promise<UpdateProjectAssetMappingResponse> {
    return this.service.update(this.key(projectId, episodeNumber), mappingId, body);
  }

  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/assets/mapping-review`)
  review(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string): Promise<GetProjectAssetMappingReviewResponse> {
    return this.service.review(this.key(projectId, episodeNumber));
  }

  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/assets/mapping-review`)
  begin(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string, @Body() body: BeginProjectAssetMappingReviewRequest): Promise<BeginProjectAssetMappingReviewResponse> {
    return this.service.beginReview(this.key(projectId, episodeNumber), body);
  }

  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/assets/mapping-review/approve`)
  approve(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string, @Body() body: unknown): Promise<ApproveProjectAssetMappingReviewResponse> {
    return this.service.approveReview(this.key(projectId, episodeNumber), body);
  }

  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/assets/mappings/:mappingId/snapshot`)
  snapshot(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string, @Param("mappingId") mappingId: string): Promise<SnapshotProjectAssetMappingResponse> {
    return this.service.snapshot(this.key(projectId, episodeNumber), mappingId);
  }
}
