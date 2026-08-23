import { Body, Controller, Delete, Param, Post } from "@nestjs/common";
import { API_ROUTES, type AddLongEpisodeRequest, type AddLongEpisodeResponse, type ArchiveLongEpisodeRequest, type ArchiveLongEpisodeResponse, type DuplicateLongEpisodeResponse } from "@ai-animation-studio/shared";
import { EpisodeTimelineService } from "./episode-timeline.service.js";

@Controller()
export class EpisodeTimelineController {
  constructor(private readonly service: EpisodeTimelineService) {}
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes`) add(@Param("projectId") id: string, @Body() body: AddLongEpisodeRequest): Promise<AddLongEpisodeResponse> { return this.service.add(id, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/duplicate`) duplicate(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<DuplicateLongEpisodeResponse> { return this.service.duplicate(id, Number(number)); }
  @Delete(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber`) archive(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: ArchiveLongEpisodeRequest): Promise<ArchiveLongEpisodeResponse> { return this.service.archive(id, Number(number), body); }
}
