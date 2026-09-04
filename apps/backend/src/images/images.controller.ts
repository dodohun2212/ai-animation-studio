import * as fs from "node:fs/promises";
import { Body, Controller, Get, HttpException, Param, Post, Req, Res, StreamableFile } from "@nestjs/common";
import { API_ROUTES, type GetGeneratedImagesResponse, type ApproveImageReviewResponse, type GetImageReviewResponse, type RegenerateImageReviewResponse, type GetImageGenerationProgressResponse, type StartImageGenerationResponse } from "@ai-animation-studio/shared";
import { streamStoredFile, type RangeRequest, type RangeResponse } from "../http/range-stream.js";
import { imageContentUnavailable } from "./image-api.error.js";
import { ImageReviewService } from "./image-review.service.js";
import { LocalImageGenerationService } from "./local-image-generation.service.js";
import { GeneratedImageLibraryService } from "./generated-image-library.service.js";

interface HttpResponse { type(value: string): void; setHeader(name: string, value: string): void }

@Controller()
export class ImagesController {
  constructor(private readonly service: LocalImageGenerationService, private readonly reviews: ImageReviewService, private readonly generatedImages: GeneratedImageLibraryService) {}

  @Post(`${API_ROUTES.projects}/:projectId/images/generations`)
  generate(@Param("projectId") projectId: string, @Body() body: unknown): Promise<StartImageGenerationResponse> {
    return this.service.generate(projectId, body);
  }

  /**
   * Progress during a run. Free, provider-free, and it refuses nothing: the review endpoint below is entitled
   * to turn away a project whose pictures are not all there, which is why this is a separate door.
   *
   * Sits under `generations` beside the POST that starts one, because it answers a question about the run
   * rather than about the pictures it leaves behind. The Episode counterpart is the same path one level in.
   */
  @Get(`${API_ROUTES.projects}/:projectId/images/generations/progress`)
  progress(@Param("projectId") projectId: string): Promise<GetImageGenerationProgressResponse> {
    return this.service.progress(projectId);
  }
  /**
   * Every generated scene image, across projects and Episodes.
   *
   * Declared before the project-scoped routes below only for readability; `/images/generated` shares no shape
   * with `/projects/:projectId/images/...`, so nothing here depends on ordering.
   */
  @Get(API_ROUTES.generatedImages)
  generated(): Promise<GetGeneratedImagesResponse> {
    return this.generatedImages.list();
  }

  @Get(`${API_ROUTES.projects}/:projectId/images/:sceneNumber/content`)
  async content(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Req() request: RangeRequest, @Res({ passthrough: true }) response: RangeResponse): Promise<StreamableFile> {
    const content = await this.service.content(projectId, sceneNumber);
    return streamStoredFile({
      path: content.path,
      contentType: "image/png",
      filename: `scene${sceneNumber}.png`,
      request, response,
      unavailable: () => imageContentUnavailable(),
    })
  }

  @Get(`${API_ROUTES.projects}/:projectId/images/review`)
  getReview(@Param("projectId") projectId: string): Promise<GetImageReviewResponse> {
    return this.reviews.getStatus(projectId);
  }

  @Post(`${API_ROUTES.projects}/:projectId/images/review/:sceneNumber/approve`)
  approveReview(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Body() body: unknown): Promise<ApproveImageReviewResponse> {
    return this.reviews.approve(projectId, sceneNumber, body);
  }

  @Post(`${API_ROUTES.projects}/:projectId/images/review/:sceneNumber/regenerate`)
  regenerateReview(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Body() body: unknown): Promise<RegenerateImageReviewResponse> {
    return this.reviews.regenerate(projectId, sceneNumber, body);
  }
}
