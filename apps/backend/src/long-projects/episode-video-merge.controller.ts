import { Body, Controller, Param, Post } from "@nestjs/common";
import { API_ROUTES, type MergeLongEpisodeVideosResponse } from "@ai-animation-studio/shared";

import { EpisodeVideoMergeService } from "./episode-video-merge.service.js";

@Controller()
export class EpisodeVideoMergeController {
  constructor(private readonly service: EpisodeVideoMergeService) {}

  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/merge`)
  merge(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: unknown): Promise<MergeLongEpisodeVideosResponse> {
    return this.service.merge(id, Number(number), body);
  }
}
