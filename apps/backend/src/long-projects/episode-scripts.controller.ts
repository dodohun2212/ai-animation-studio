import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { API_ROUTES, type ApproveLongEpisodeScriptRequest, type ApproveLongEpisodeScriptResponse, type GenerateLongEpisodeScriptRequest, type GenerateLongEpisodeScriptResponse, type GetLongEpisodeResponse, type UpdateLongEpisodeScriptRequest, type UpdateLongEpisodeScriptResponse } from "@ai-animation-studio/shared";
import { EpisodeScriptsService } from "./episode-scripts.service.js";

@Controller()
export class EpisodeScriptsController {
  constructor(private readonly service: EpisodeScriptsService) {}
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber`) get(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeResponse> { return this.service.get(id, Number(number)); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/script/generations`) generate(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: GenerateLongEpisodeScriptRequest): Promise<GenerateLongEpisodeScriptResponse> { return this.service.generate(id, Number(number), body); }
  @Patch(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/script`) update(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: UpdateLongEpisodeScriptRequest): Promise<UpdateLongEpisodeScriptResponse> { return this.service.update(id, Number(number), body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/script/approval`) approve(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: ApproveLongEpisodeScriptRequest): Promise<ApproveLongEpisodeScriptResponse> { return this.service.approve(id, Number(number), body); }
}
