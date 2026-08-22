import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { API_ROUTES, type CreateLongStoryBibleItemRequest, type CreateLongStoryBibleItemResponse, type DeleteLongStoryBibleItemResponse, type GetLongProjectStoryBibleResponse, type UpdateLongStoryBibleItemRequest, type UpdateLongStoryBibleItemResponse } from "@ai-animation-studio/shared";
import { StoryBibleService } from "./story-bible.service.js";

@Controller()
export class StoryBibleController {
  constructor(private readonly service: StoryBibleService) {}
  @Get(`${API_ROUTES.longProjects}/:projectId/story-bible`) get(@Param("projectId") projectId: string): Promise<GetLongProjectStoryBibleResponse> { return this.service.get(projectId); }
  @Post(`${API_ROUTES.longProjects}/:projectId/story-bible/:collection`) create(@Param("projectId") projectId: string, @Param("collection") collection: string, @Body() body: CreateLongStoryBibleItemRequest): Promise<CreateLongStoryBibleItemResponse> { return this.service.create(projectId, collection, body); }
  @Patch(`${API_ROUTES.longProjects}/:projectId/story-bible/:collection/:itemId`) update(@Param("projectId") projectId: string, @Param("collection") collection: string, @Param("itemId") itemId: string, @Body() body: UpdateLongStoryBibleItemRequest): Promise<UpdateLongStoryBibleItemResponse> { return this.service.update(projectId, collection, itemId, body); }
  @Delete(`${API_ROUTES.longProjects}/:projectId/story-bible/:collection/:itemId`) delete(@Param("projectId") projectId: string, @Param("collection") collection: string, @Param("itemId") itemId: string): Promise<DeleteLongStoryBibleItemResponse> { return this.service.delete(projectId, collection, itemId); }
}
