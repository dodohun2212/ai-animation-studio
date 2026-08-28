import * as fs from "node:fs/promises";

import { Body, Controller, Get, HttpException, Param, Post, Res, StreamableFile } from "@nestjs/common";
import type { Response as HttpResponse } from "express";
import { API_ROUTES, type ApproveLongEpisodeImageReviewRequest, type ApproveLongEpisodeImageReviewResponse, type GetLongEpisodeImageReviewResponse, type RegenerateLongEpisodeImageReviewRequest, type RegenerateLongEpisodeImageReviewResponse, type StartLongEpisodeImageGenerationRequest, type StartLongEpisodeImageGenerationResponse } from "@ai-animation-studio/shared";
import { longEpisodeImagesInvalid } from "./long-project-api.error.js";
import { EpisodeImagesService } from "./episode-images.service.js";

@Controller()
export class EpisodeImagesController {
  constructor(private readonly service: EpisodeImagesService) {}
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/generations`) generate(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: StartLongEpisodeImageGenerationRequest): Promise<StartLongEpisodeImageGenerationResponse> { return this.service.generate(id, Number(number), body); }
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/review`) get(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeImageReviewResponse> { return this.service.get(id, Number(number)); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/review/:sceneNumber/approve`) approve(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Body() body: ApproveLongEpisodeImageReviewRequest): Promise<ApproveLongEpisodeImageReviewResponse> { return this.service.approve(id, Number(number), scene, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/review/:sceneNumber/regenerate`) regenerate(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Body() body: RegenerateLongEpisodeImageReviewRequest): Promise<RegenerateLongEpisodeImageReviewResponse> { return this.service.regenerate(id, Number(number), scene, body); }

  /**
   * The bytes of one Episode scene's image. The short project's counterpart is images.controller.ts's content().
   *
   * Streamed rather than base64'd into the review response for the same reason that one is: six generated
   * pictures in a JSON body is a payload nobody can cache, and the browser already knows how to fetch an image.
   */
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/:sceneNumber/content`)
  async content(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Res({ passthrough: true }) response: HttpResponse): Promise<StreamableFile> {
    const content = await this.service.content(id, Number(number), scene);
    try {
      const handle = await fs.open(content.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); throw longEpisodeImagesInvalid(); }
      response.type("image/png");
      response.setHeader("Content-Disposition", `inline; filename="scene${scene}.png"`);
      response.setHeader("Content-Length", String(stat.size));
      response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(handle.createReadStream());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw longEpisodeImagesInvalid();
    }
  }
}
