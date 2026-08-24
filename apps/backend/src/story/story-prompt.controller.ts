import { Body, Controller, Param, Post } from "@nestjs/common";
import { API_ROUTES, type ApproveStoryPromptResponse, type CreateStoryPromptDraftPreviewResponse, type CreateStoryPromptPreviewResponse } from "@ai-animation-studio/shared";
import { StoryPromptService } from "./story-prompt.service.js";

@Controller()
export class StoryPromptController {
  constructor(private readonly service: StoryPromptService) {}
  @Post(`${API_ROUTES.projects}/:projectId/story/preview`)
  preview(@Param("projectId") projectId: string): Promise<CreateStoryPromptPreviewResponse> { return this.service.preview(projectId); }
  @Post(`${API_ROUTES.projects}/:projectId/story/draft-preview`)
  draftPreview(@Param("projectId") projectId: string, @Body() body: unknown): Promise<CreateStoryPromptDraftPreviewResponse> {
    return this.service.draftPreview(projectId, body);
  }
  @Post(`${API_ROUTES.projects}/:projectId/story/approval`)
  approve(@Param("projectId") projectId: string, @Body() body: unknown): Promise<ApproveStoryPromptResponse> { return this.service.approve(projectId, body); }
}
