import * as fs from "node:fs/promises";
import { Body, Controller, Get, HttpException, Param, Post, Req, Res, StreamableFile } from "@nestjs/common";
import { API_ROUTES, type GetNarrationReviewResponse, type RegenerateNarrationResponse, type StartNarrationGenerationResponse } from "@ai-animation-studio/shared";
import { streamStoredFile, type RangeRequest, type RangeResponse } from "../http/range-stream.js";
import { narrationContentUnavailable } from "./narration-api.error.js";
import { LocalNarrationGenerationService } from "./local-narration-generation.service.js";
import { NarrationReviewService } from "./narration-review.service.js";

interface HttpResponse { type(value: string): void; setHeader(name: string, value: string): void }

@Controller()
export class NarrationController {
  constructor(private readonly service: LocalNarrationGenerationService, private readonly reviews: NarrationReviewService) {}

  @Post(`${API_ROUTES.projects}/:projectId/narration/generations`)
  generate(@Param("projectId") projectId: string, @Body() body: unknown): Promise<StartNarrationGenerationResponse> {
    return this.service.generate(projectId, body);
  }

  @Get(`${API_ROUTES.projects}/:projectId/narration/:sceneNumber/content`)
  async content(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Req() request: RangeRequest, @Res({ passthrough: true }) response: RangeResponse): Promise<StreamableFile> {
    const content = await this.service.content(projectId, sceneNumber);
    return streamStoredFile({
      path: content.path,
      contentType: "audio/mpeg",
      filename: `scene${sceneNumber}.mp3`,
      request, response,
      unavailable: () => narrationContentUnavailable(),
    })
  }

  @Get(`${API_ROUTES.projects}/:projectId/narration/review`)
  getReview(@Param("projectId") projectId: string): Promise<GetNarrationReviewResponse> {
    return this.reviews.getStatus(projectId);
  }

  @Post(`${API_ROUTES.projects}/:projectId/narration/review/:sceneNumber/regenerate`)
  regenerateReview(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Body() body: unknown): Promise<RegenerateNarrationResponse> {
    return this.reviews.regenerate(projectId, sceneNumber, body);
  }
}
