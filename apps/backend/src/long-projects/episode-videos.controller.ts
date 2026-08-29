import { Body, Controller, Get, HttpException, Param, Post, Res, StreamableFile } from "@nestjs/common";
import type { Response as HttpResponse } from "express";
import * as fs from "node:fs/promises";
import { API_ROUTES, type ApproveLongEpisodeVideoReviewRequest, type ApproveLongEpisodeVideoReviewResponse, type GetLongEpisodeCurrentVideoJobResponse, type GetLongEpisodeVideoPreviewResponse, type GetLongEpisodeVideoReviewResponse, type LongEpisodeVideoProgress, type RecoverLongEpisodeVideosResponse, type RegenerateLongEpisodeVideoResponse, type StartLongEpisodeVideoGenerationRequest, type StartLongEpisodeVideoGenerationResponse } from "@ai-animation-studio/shared";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { longEpisodeVideosInvalid } from "./long-project-api.error.js";

@Controller()
export class EpisodeVideosController {
  constructor(private readonly service: EpisodeVideosService) {}
  /**
   * Streams one scene's clip so a review card can hold a player.
   *
   * The short project has had this since its review screen existed; the Episode never did, so its cards showed
   * a status and a filename. Six placeholders were approved through that screen — a player is what lets a
   * person check the claim the status makes.
   */
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/:sceneNumber/content`)
  async content(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("sceneNumber") scene: string, @Res({ passthrough: true }) response: HttpResponse): Promise<StreamableFile> {
    const content = await this.service.content(id, Number(number), scene);
    try {
      const handle = await fs.open(content.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); throw longEpisodeVideosInvalid(); }
      response.type("video/mp4");
      response.setHeader("Content-Disposition", `inline; filename="scene${scene}.mp4"`);
      response.setHeader("Content-Length", String(stat.size));
      response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(handle.createReadStream());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw longEpisodeVideosInvalid();
    }
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
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/scenes/:sceneNumber/regenerate`) regenerate(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string, @Param("sceneNumber") scene: string, @Body() body: unknown): Promise<RegenerateLongEpisodeVideoResponse> { return this.service.regenerate(id, Number(number), job, scene, body); }
  @Get(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/review`) review(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string): Promise<GetLongEpisodeVideoReviewResponse> { return this.service.review(id, Number(number), job); }
  @Post(`${API_ROUTES.longProjects}/:projectId/episodes/:episodeNumber/videos/generations/:jobId/review/:sceneNumber/approve`) approve(@Param("projectId") id: string, @Param("episodeNumber") number: string, @Param("jobId") job: string, @Param("sceneNumber") scene: string, @Body() body: ApproveLongEpisodeVideoReviewRequest): Promise<ApproveLongEpisodeVideoReviewResponse> { return this.service.approve(id, Number(number), job, scene, body); }
}
