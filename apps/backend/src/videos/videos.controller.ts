import { Body, Controller, Param, Post } from "@nestjs/common";
import { API_ROUTES, type GetVideoPromptPreviewResponse, type StartVideoGenerationResponse } from "@ai-animation-studio/shared";

import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";

@Controller()
export class VideosController {
  constructor(private readonly previews: LocalVideoPreviewService, private readonly submissions: LocalVideoSubmissionService) {}

  @Post(`${API_ROUTES.projects}/:projectId/videos/preview`)
  preview(@Param("projectId") projectId: string, @Body() body: unknown): Promise<GetVideoPromptPreviewResponse> {
    return this.previews.preview(projectId, body);
  }

  @Post(`${API_ROUTES.projects}/:projectId/videos/generations`)
  start(@Param("projectId") projectId: string, @Body() body: unknown): Promise<StartVideoGenerationResponse> {
    return this.submissions.start(projectId, body);
  }
}
