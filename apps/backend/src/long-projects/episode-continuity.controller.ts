import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { API_ROUTES, type GetLongEpisodeContinuityResponse, type SaveLongEpisodeContinuityRequest, type SaveLongEpisodeContinuityResponse } from "@ai-animation-studio/shared";
import { EpisodeContinuityService } from "./episode-continuity.service.js";

@Controller()
export class EpisodeContinuityController {
  constructor(private readonly service: EpisodeContinuityService) {}

  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/continuity`)
  get(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeContinuityResponse> { return this.service.get(id, Number(number)); }

  @Put(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/continuity`)
  save(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: SaveLongEpisodeContinuityRequest): Promise<SaveLongEpisodeContinuityResponse> { return this.service.save(id, Number(number), body); }
}
