import * as fs from "node:fs/promises";
import { Body, Controller, Get, HttpException, Param, Post, Res, StreamableFile } from "@nestjs/common";
import { API_ROUTES, type GetNarrationReviewResponse, type RegenerateNarrationResponse, type StartNarrationGenerationResponse } from "@ai-animation-studio/shared";
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
  async content(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Res({ passthrough: true }) response: HttpResponse): Promise<StreamableFile> {
    const content = await this.service.content(projectId, sceneNumber);
    try {
      const handle = await fs.open(content.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); throw narrationContentUnavailable(); }
      response.type("audio/mpeg");
      response.setHeader("Content-Disposition", `inline; filename="scene${sceneNumber}.mp3"`);
      response.setHeader("Content-Length", String(stat.size));
      response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(handle.createReadStream());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw narrationContentUnavailable();
    }
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
