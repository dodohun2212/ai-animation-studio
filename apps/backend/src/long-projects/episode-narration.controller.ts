import * as fs from "node:fs/promises";
import { Body, Controller, Get, HttpException, Param, Post, Res, StreamableFile } from "@nestjs/common";
import { API_ROUTES, type GetLongEpisodeNarrationReviewResponse, type RegenerateLongEpisodeNarrationResponse, type StartLongEpisodeNarrationGenerationRequest, type StartLongEpisodeNarrationGenerationResponse } from "@ai-animation-studio/shared";
import { longEpisodeNarrationContentUnavailable } from "./long-project-api.error.js";
import { EpisodeNarrationService } from "./episode-narration.service.js";

interface HttpResponse { type(value: string): void; setHeader(name: string, value: string): void }

@Controller()
export class EpisodeNarrationController {
  constructor(private readonly service: EpisodeNarrationService) {}

  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/narration/generations`)
  generate(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string, @Body() body: StartLongEpisodeNarrationGenerationRequest): Promise<StartLongEpisodeNarrationGenerationResponse> {
    return this.service.generate(projectId, Number(episodeNumber), body);
  }

  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/narration/review`)
  getReview(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string): Promise<GetLongEpisodeNarrationReviewResponse> {
    return this.service.get(projectId, Number(episodeNumber));
  }

  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/narration/review/:sceneNumber/regenerate`)
  regenerateReview(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string, @Param("sceneNumber") sceneNumber: string, @Body() body: unknown): Promise<RegenerateLongEpisodeNarrationResponse> {
    return this.service.regenerate(projectId, Number(episodeNumber), sceneNumber, body);
  }

  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/narration/:sceneNumber/content`)
  async content(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string, @Param("sceneNumber") sceneNumber: string, @Res({ passthrough: true }) response: HttpResponse): Promise<StreamableFile> {
    const content = await this.service.content(projectId, Number(episodeNumber), sceneNumber);
    try {
      const handle = await fs.open(content.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); throw longEpisodeNarrationContentUnavailable(); }
      response.type("audio/mpeg");
      response.setHeader("Content-Disposition", `inline; filename="scene${sceneNumber}.mp3"`);
      response.setHeader("Content-Length", String(stat.size));
      response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(handle.createReadStream());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw longEpisodeNarrationContentUnavailable();
    }
  }
}
