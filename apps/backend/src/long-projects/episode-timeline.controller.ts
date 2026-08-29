import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { API_ROUTES, type AddLongEpisodeRequest, type AddLongEpisodeResponse, type ArchiveLongEpisodeRequest, type ArchiveLongEpisodeResponse, type DuplicateLongEpisodeResponse, type ListArchivedLongEpisodesResponse, type RestoreLongEpisodeResponse, type UpdateLongEpisodeOutlineRequest, type UpdateLongEpisodeOutlineResponse } from "@ai-animation-studio/shared";
import { EpisodeTimelineService } from "./episode-timeline.service.js";

@Controller()
export class EpisodeTimelineController {
  constructor(private readonly service: EpisodeTimelineService) {}
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes`) add(@Param("projectId") id: string, @Body() body: AddLongEpisodeRequest): Promise<AddLongEpisodeResponse> { return this.service.add(id, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/duplicate`) duplicate(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<DuplicateLongEpisodeResponse> { return this.service.duplicate(id, Number(number)); }
  /** What this project has archived, and the one route that brings one back — an archive nothing can read is a deletion. */
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/archives`) listArchives(@Param("projectId") id: string): Promise<ListArchivedLongEpisodesResponse> { return this.service.listArchives(id); }

  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/archives/:archiveId/restore`) restoreArchive(@Param("projectId") id: string, @Param("archiveId") archiveId: string, @Body() body: unknown): Promise<RestoreLongEpisodeResponse> { return this.service.restoreArchive(id, archiveId, body); }

  @Delete(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber`) archive(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: ArchiveLongEpisodeRequest): Promise<ArchiveLongEpisodeResponse> { return this.service.archive(id, Number(number), body); }
  @Patch(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/outline`) updateOutline(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: UpdateLongEpisodeOutlineRequest): Promise<UpdateLongEpisodeOutlineResponse> { return this.service.updateOutline(id, Number(number), body); }
}
