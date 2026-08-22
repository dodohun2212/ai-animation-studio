import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { API_ROUTES, type ApproveImageReviewResponse, type GetImageReviewResponse, type StartImageGenerationResponse } from "@ai-animation-studio/shared";
import { ImageReviewService } from "./image-review.service.js";
import { LocalImageGenerationService } from "./local-image-generation.service.js";

@Controller()
export class ImagesController {
  constructor(private readonly service: LocalImageGenerationService, private readonly reviews: ImageReviewService) {}

  @Post(`${API_ROUTES.projects}/:projectId/images/generations`)
  generate(@Param("projectId") projectId: string, @Body() body: unknown): Promise<StartImageGenerationResponse> {
    return this.service.generate(projectId, body);
  }

  @Get(`${API_ROUTES.projects}/:projectId/images/review`)
  getReview(@Param("projectId") projectId: string): Promise<GetImageReviewResponse> {
    return this.reviews.getStatus(projectId);
  }

  @Post(`${API_ROUTES.projects}/:projectId/images/review/:sceneNumber/approve`)
  approveReview(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Body() body: unknown): Promise<ApproveImageReviewResponse> {
    return this.reviews.approve(projectId, sceneNumber, body);
  }
}
