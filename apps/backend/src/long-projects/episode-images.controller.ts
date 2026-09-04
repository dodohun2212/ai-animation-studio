import * as fs from "node:fs/promises";

import { Body, Controller, Get, HttpException, Param, Post, Req, Res, StreamableFile } from "@nestjs/common";
import type { Response as HttpResponse } from "express";
import { API_ROUTES, type ApproveLongEpisodeImageReviewRequest, type ApproveLongEpisodeImageReviewResponse, type GetLongEpisodeImagePreviewResponse, type GetLongEpisodeImageProgressResponse, type GetLongEpisodeImageReviewResponse, type RegenerateLongEpisodeImageReviewRequest, type RegenerateLongEpisodeImageReviewResponse, type StartLongEpisodeImageGenerationRequest, type StartLongEpisodeImageGenerationResponse } from "@ai-animation-studio/shared";
import { streamStoredFile, type RangeRequest, type RangeResponse } from "../http/range-stream.js";
import { longEpisodeImagesInvalid } from "./long-project-api.error.js";
import { EpisodeImagesService } from "./episode-images.service.js";

@Controller()
export class EpisodeImagesController {
  constructor(private readonly service: EpisodeImagesService) {}
  /** Free preflight: which scenes a generation would actually buy. Reads files, never the provider. */
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/generations/preview`) preview(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeImagePreviewResponse> { return this.service.preview(id, Number(number)); }

  /**
   * Progress during a run. Sits beside `preview` under `generations` because both answer questions about the
   * generation itself rather than about the pictures it left behind, and neither costs anything to ask.
   *
   * No job id in the path, unlike the video counterpart: an Episode's images are generated inside the request
   * that asked for them and there is no job to name. The Episode and its files are the whole identity.
   */
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/generations/progress`) progress(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeImageProgressResponse> { return this.service.progress(id, Number(number)); }

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
  async content(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Req() request: RangeRequest, @Res({ passthrough: true }) response: RangeResponse): Promise<StreamableFile> {
    const content = await this.service.content(id, Number(number), scene);
    return streamStoredFile({
      path: content.path,
      contentType: "image/png",
      filename: `scene${scene}.png`,
      request, response,
      unavailable: () => longEpisodeImagesInvalid(),
    })
  }
}
