import * as fs from "node:fs/promises";
import { Body, Controller, Get, HttpException, Param, Post, Req, Res, StreamableFile } from "@nestjs/common";
import { API_ROUTES, type GetLongEpisodeNarrationReviewResponse, type RegenerateLongEpisodeNarrationResponse, type StartLongEpisodeNarrationGenerationRequest, type StartLongEpisodeNarrationGenerationResponse } from "@ai-animation-studio/shared";
import { streamStoredFile, type RangeRequest, type RangeResponse } from "../http/range-stream.js";
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
  async content(@Param("projectId") projectId: string, @Param("episodeNumber") episodeNumber: string, @Param("sceneNumber") sceneNumber: string, @Req() request: RangeRequest, @Res({ passthrough: true }) response: RangeResponse): Promise<StreamableFile> {
    const content = await this.service.content(projectId, Number(episodeNumber), sceneNumber);
    return streamStoredFile({
      path: content.path,
      contentType: "audio/mpeg",
      filename: `scene${sceneNumber}.mp3`,
      request, response,
      unavailable: () => longEpisodeNarrationContentUnavailable(),
    })
  }
}
