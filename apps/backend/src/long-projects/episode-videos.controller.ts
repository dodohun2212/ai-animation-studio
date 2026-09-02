import { Body, Controller, Get, HttpException, Param, Post, Req, Res, StreamableFile } from "@nestjs/common";
import type { Response as HttpResponse } from "express";
import * as fs from "node:fs/promises";
import { API_ROUTES, type ApproveLongEpisodeVideoReviewRequest, type ApproveLongEpisodeVideoReviewResponse, type GetLongEpisodeCurrentVideoJobResponse, type GetLongEpisodeVideoPreviewResponse, type GetLongEpisodeVideoReviewResponse, type LongEpisodeVideoProgress, type GetVideoVersionsResponse, type RecoverLongEpisodeVideosResponse, type RegenerateLongEpisodeVideoResponse, type RestoreLongEpisodeVideoVersionResponse, type StartLongEpisodeVideoGenerationRequest, type StartLongEpisodeVideoGenerationResponse } from "@ai-animation-studio/shared";
import { streamStoredFile, type RangeRequest, type RangeResponse } from "../http/range-stream.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { EpisodeVideoMergeService } from "./episode-video-merge.service.js";
import { longEpisodeMergeClipsInvalid, longEpisodeVideoVersionNotFound, longEpisodeVideosInvalid } from "./long-project-api.error.js";

@Controller()
export class EpisodeVideosController {
  constructor(private readonly service: EpisodeVideosService, private readonly merges: EpisodeVideoMergeService) {}
  /**
   * Streams one scene's clip so a review card can hold a player.
   *
   * The short project has had this since its review screen existed; the Episode never did, so its cards showed
   * a status and a filename. Six placeholders were approved through that screen — a player is what lets a
   * person check the claim the status makes.
   */
  /**
   * Streams the Episode's merged final video.
   *
   * Registered before the `:sceneNumber` route below, and in this controller rather than beside the merge it
   * belongs to, because the two paths are the same shape to a router and registration order is what decides
   * which one answers. Declared in a separate controller it lost: `final` was parsed as a scene number and
   * every request came back as an invalid scene rather than the video. The short project's videos controller
   * carries the same pairing for the same reason.
   *
   * Without this the finished Episode video had no address at all — the merge screen printed its file path as
   * text held in React state, so a reload left it unreachable.
   */
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/final/content`)
  async finalContent(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Req() request: RangeRequest, @Res({ passthrough: true }) response: RangeResponse): Promise<StreamableFile> {
    const content = await this.merges.content(id, Number(number));
    return streamStoredFile({
      path: content.path,
      contentType: "video/mp4",
      filename: `episode${number}_final.mp4`,
      request, response,
      unavailable: () => longEpisodeMergeClipsInvalid(),
    })
  }

  /**
   * Past copies of one scene's clip: list, play, restore.
   *
   * Declared above `:sceneNumber/content` for the same reason `final/content` is — sibling routes under
   * `videos/` are decided by registration order, and that ordering has already been wrong once here.
   */
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/:sceneNumber/versions`)
  versions(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string): Promise<GetVideoVersionsResponse> {
    return this.service.versions(id, Number(number), scene);
  }

  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/:sceneNumber/versions/:versionId/content`)
  async versionContent(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Param("versionId") versionId: string, @Req() request: RangeRequest, @Res({ passthrough: true }) response: RangeResponse): Promise<StreamableFile> {
    const content = await this.service.versionContent(id, Number(number), scene, versionId);
    return streamStoredFile({
      path: content.path,
      contentType: "video/mp4",
      filename: `scene${scene}_${versionId}.mp4`,
      request, response,
      unavailable: () => longEpisodeVideoVersionNotFound(),
    })
  }

  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/:sceneNumber/versions/:versionId/restore`)
  restoreVersion(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Param("versionId") versionId: string, @Body() body: unknown): Promise<RestoreLongEpisodeVideoVersionResponse> {
    return this.service.restoreVersion(id, Number(number), scene, versionId, body);
  }

  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/:sceneNumber/content`)
  async content(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Req() request: RangeRequest, @Res({ passthrough: true }) response: RangeResponse): Promise<StreamableFile> {
    const content = await this.service.content(id, Number(number), scene);
    return streamStoredFile({
      path: content.path,
      contentType: "video/mp4",
      filename: `scene${scene}.mp4`,
      request, response,
      unavailable: () => longEpisodeVideosInvalid(),
    })
  }
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/preview`) preview(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeVideoPreviewResponse> { return this.service.preview(id, Number(number)); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations`) async start(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Body() body: StartLongEpisodeVideoGenerationRequest): Promise<StartLongEpisodeVideoGenerationResponse> { const started = await this.service.start(id, Number(number), body); void this.service.run(id, Number(number), started.jobId).catch(() => undefined); return started; }
  /** The way back to a running generation after a reload — see EpisodeVideosService.currentJob. */
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/current`)
  currentJob(@Param("projectId") id: string, @Param("episodeNumber") number: string): Promise<GetLongEpisodeCurrentVideoJobResponse> {
    return this.service.currentJob(id, Number(number));
  }
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId`) progress(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string): Promise<LongEpisodeVideoProgress> { return this.service.progress(id, Number(number), job); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/stop`) stop(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string): Promise<LongEpisodeVideoProgress> { return this.service.stop(id, Number(number), job); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/restart`) restart(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string): Promise<LongEpisodeVideoProgress> { return this.service.restart(id, Number(number), job); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/recovery`) recover(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string, @Body() body: unknown): Promise<RecoverLongEpisodeVideosResponse> { return this.service.recover(id, Number(number), job, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/regenerate-all`) regenerateAll(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string, @Body() body: unknown): Promise<RegenerateLongEpisodeVideoResponse> { return this.service.regenerateAll(id, Number(number), job, body); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/scenes/:sceneNumber/regenerate`) regenerate(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string, @Param("sceneNumber") scene: string, @Body() body: unknown): Promise<RegenerateLongEpisodeVideoResponse> { return this.service.regenerate(id, Number(number), job, scene, body); }
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/review`) review(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string): Promise<GetLongEpisodeVideoReviewResponse> { return this.service.review(id, Number(number), job); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/review/:sceneNumber/approve`) approve(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string, @Param("sceneNumber") scene: string, @Body() body: ApproveLongEpisodeVideoReviewRequest): Promise<ApproveLongEpisodeVideoReviewResponse> { return this.service.approve(id, Number(number), job, scene, body); }
}
