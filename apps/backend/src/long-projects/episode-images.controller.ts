import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { API_ROUTES, type ApproveLongEpisodeImageReviewRequest, type ApproveLongEpisodeImageReviewResponse, type GetLongEpisodeImageReviewResponse, type RegenerateLongEpisodeImageReviewRequest, type RegenerateLongEpisodeImageReviewResponse, type StartLongEpisodeImageGenerationRequest, type StartLongEpisodeImageGenerationResponse } from "@ai-animation-studio/shared";
import { EpisodeImagesService } from "./episode-images.service.js";

@Controller()
export class EpisodeImagesController {
  constructor(private readonly service: EpisodeImagesService) {}
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/generations`) generate(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: StartLongEpisodeImageGenerationRequest): Promise<StartLongEpisodeImageGenerationResponse> { return this.service.generate(id, Number(number), body); }
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/review`) get(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeImageReviewResponse> { return this.service.get(id, Number(number)); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/review/:sceneNumber/approve`) approve(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Body() body: ApproveLongEpisodeImageReviewRequest): Promise<ApproveLongEpisodeImageReviewResponse> { return this.service.approve(id, Number(number), scene, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/images/review/:sceneNumber/regenerate`) regenerate(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Body() body: RegenerateLongEpisodeImageReviewRequest): Promise<RegenerateLongEpisodeImageReviewResponse> { return this.service.regenerate(id, Number(number), scene, body); }
}
