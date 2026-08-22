import { Body, Controller, Param, Post } from "@nestjs/common";
import { API_ROUTES, type GetVideoPromptPreviewResponse } from "@ai-animation-studio/shared";

import { LocalVideoPreviewService } from "./video-preview.service.js";

@Controller()
export class VideosController {
  constructor(private readonly previews: LocalVideoPreviewService) {}

  @Post(`${API_ROUTES.projects}/:projectId/videos/preview`)
  preview(@Param("projectId") projectId: string, @Body() body: unknown): Promise<GetVideoPromptPreviewResponse> {
    return this.previews.preview(projectId, body);
  }
}
