import { Body, Controller, Param, Post } from "@nestjs/common";
import { API_ROUTES, type ApproveNovelStoryAnalysisRequest, type ApproveNovelStoryAnalysisResponse, type GenerateNovelCharacterImageResponse, type NovelCharacterImagePreviewResponse, type NovelStoryAnalysisPreviewResponse, type ApproveStoryPromptResponse, type CreateStoryPromptDraftPreviewResponse, type CreateStoryPromptPreviewResponse, type RegenerateStoryPromptResponse } from "@ai-animation-studio/shared";
import { StoryPromptService } from "./story-prompt.service.js";
import { StoryAnalysisService } from "./story-analysis.service.js";
import { NovelCharacterImageService } from "./novel-character-image.service.js";

@Controller()
export class StoryPromptController {
  constructor(private readonly service: StoryPromptService, private readonly analysis: StoryAnalysisService, private readonly characterImage: NovelCharacterImageService) {}
  @Post(API_ROUTES.novelStoryAnalysisPreview)
  previewNovelAnalysis(@Body() body: unknown): Promise<NovelStoryAnalysisPreviewResponse> { return this.analysis.preview(body); }
  @Post(API_ROUTES.novelStoryAnalysis)
  approveNovelAnalysis(@Body() body: ApproveNovelStoryAnalysisRequest): Promise<ApproveNovelStoryAnalysisResponse> { return this.analysis.approve(body); }
  @Post(API_ROUTES.novelCharacterImagePreview)
  previewNovelCharacterImage(@Body() body: unknown): Promise<NovelCharacterImagePreviewResponse> { return this.characterImage.preview(body); }
  @Post(API_ROUTES.novelCharacterImageGenerate)
  generateNovelCharacterImage(@Body() body: unknown): Promise<GenerateNovelCharacterImageResponse> { return this.characterImage.approve(body); }
  @Post(`${API_ROUTES.projects}/:projectId/story/preview`)
  preview(@Param("projectId") projectId: string): Promise<CreateStoryPromptPreviewResponse> { return this.service.preview(projectId); }
  @Post(`${API_ROUTES.projects}/:projectId/story/draft-preview`)
  draftPreview(@Param("projectId") projectId: string, @Body() body: unknown): Promise<CreateStoryPromptDraftPreviewResponse> {
    return this.service.draftPreview(projectId, body);
  }
  @Post(`${API_ROUTES.projects}/:projectId/story/approval`)
  approve(@Param("projectId") projectId: string, @Body() body: unknown): Promise<ApproveStoryPromptResponse> { return this.service.approve(projectId, body); }
  @Post(`${API_ROUTES.projects}/:projectId/story/regenerate`)
  regenerate(@Param("projectId") projectId: string, @Body() body: unknown): Promise<RegenerateStoryPromptResponse> { return this.service.regenerate(projectId, body); }
}
