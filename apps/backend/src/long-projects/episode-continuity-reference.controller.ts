import { Controller, Get, Param } from "@nestjs/common";
import { API_ROUTES, type GetLongEpisodeContinuityReferenceResponse } from "@ai-animation-studio/shared";
import { EpisodeContinuityReferenceService } from "./episode-continuity-reference.service.js";

@Controller()
export class EpisodeContinuityReferenceController {
  constructor(private readonly service: EpisodeContinuityReferenceService) {}

  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/continuity-reference`)
  get(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeContinuityReferenceResponse> { return this.service.get(id, Number(number)); }
}
