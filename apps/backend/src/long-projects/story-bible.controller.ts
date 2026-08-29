import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { API_ROUTES, type CreateLongStoryBibleItemRequest, type CreateLongStoryBibleItemResponse, type DeleteLongStoryBibleItemResponse, type DuplicateLongStoryBibleItemResponse, type GetLongProjectStoryBibleResponse, type SearchLongStoryBibleItemsResponse, type UpdateLongStoryBibleWorldRequest, type UpdateLongStoryBibleWorldResponse, type UpdateLongStoryBibleItemRequest, type UpdateLongStoryBibleItemResponse, type UpdateLongStoryBibleProtagonistAssetLinkRequest, type UpdateLongStoryBibleProtagonistAssetLinkResponse, type UpdateLongStoryBibleStyleAssetLinkRequest, type UpdateLongStoryBibleStyleAssetLinkResponse } from "@ai-animation-studio/shared";
import { StoryBibleService } from "./story-bible.service.js";

@Controller()
export class StoryBibleController {
  constructor(private readonly service: StoryBibleService) {}
  @Get(`${API_ROUTES.longProjects}/:projectId/story-bible`) get(@Param("projectId") projectId: string): Promise<GetLongProjectStoryBibleResponse> { return this.service.get(projectId); }
  @Patch(`${API_ROUTES.longProjects}/:projectId/story-bible/world`) updateWorld(@Param("projectId") projectId: string, @Body() body: UpdateLongStoryBibleWorldRequest): Promise<UpdateLongStoryBibleWorldResponse> { return this.service.updateWorld(projectId, body); }
  @Patch(`${API_ROUTES.longProjects}/:projectId/story-bible/style-asset-link`) updateStyleAssetLink(@Param("projectId") projectId: string, @Body() body: UpdateLongStoryBibleStyleAssetLinkRequest): Promise<UpdateLongStoryBibleStyleAssetLinkResponse> { return this.service.updateStyleAssetLink(projectId, body); }
  @Patch(`${API_ROUTES.longProjects}/:projectId/story-bible/protagonist-asset-link`) updateProtagonistAssetLink(@Param("projectId") projectId: string, @Body() body: UpdateLongStoryBibleProtagonistAssetLinkRequest): Promise<UpdateLongStoryBibleProtagonistAssetLinkResponse> { return this.service.updateProtagonistAssetLink(projectId, body); }
  /**
   * `@Query`, not `@Param`: the search text rides in `?query=`, and this path has no `:query` segment for a
   * route parameter to bind to. Read as a param it was `undefined` on every call, so the service rejected the
   * request as invalid — a route that could not succeed for any input, on either side of which everything
   * looked correct. See story-bible-http.integration.test.ts, which drives the URL the client builds.
   */
  @Get(`${API_ROUTES.longProjects}/:projectId/story-bible/:collection/search`) search(@Param("projectId") projectId: string, @Param("collection") collection: string, @Query("query") query: unknown): Promise<SearchLongStoryBibleItemsResponse> { return this.service.search(projectId, collection, query); }
  @Post(`${API_ROUTES.longProjects}/:projectId/story-bible/:collection`) create(@Param("projectId") projectId: string, @Param("collection") collection: string, @Body() body: CreateLongStoryBibleItemRequest): Promise<CreateLongStoryBibleItemResponse> { return this.service.create(projectId, collection, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/story-bible/:collection/:itemId/duplicate`) duplicate(@Param("projectId") projectId: string, @Param("collection") collection: string, @Param("itemId") itemId: string): Promise<DuplicateLongStoryBibleItemResponse> { return this.service.duplicate(projectId, collection, itemId); }
  @Patch(`${API_ROUTES.longProjects}/:projectId/story-bible/:collection/:itemId`) update(@Param("projectId") projectId: string, @Param("collection") collection: string, @Param("itemId") itemId: string, @Body() body: UpdateLongStoryBibleItemRequest): Promise<UpdateLongStoryBibleItemResponse> { return this.service.update(projectId, collection, itemId, body); }
  @Delete(`${API_ROUTES.longProjects}/:projectId/story-bible/:collection/:itemId`) delete(@Param("projectId") projectId: string, @Param("collection") collection: string, @Param("itemId") itemId: string): Promise<DeleteLongStoryBibleItemResponse> { return this.service.delete(projectId, collection, itemId); }
}
