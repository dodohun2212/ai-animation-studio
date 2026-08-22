import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { API_ROUTES, type ApproveVideoReviewResponse, type GenerationProgressResponse, type GetVideoPromptPreviewResponse, type GetVideoReviewResponse, type MergeVideosResponse, type RegenerateVideoResponse, type StartVideoGenerationResponse } from "@ai-animation-studio/shared";

import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";
import { LocalVideoWorkflowService } from "./local-video-workflow.service.js";
import { LocalVideoMergeService } from "./video-merge.service.js";

@Controller()
export class VideosController {
  constructor(private readonly previews: LocalVideoPreviewService, private readonly submissions: LocalVideoSubmissionService, private readonly workflow: LocalVideoWorkflowService, private readonly mergeService: LocalVideoMergeService) {}

  @Post(`${API_ROUTES.projects}/:projectId/videos/preview`)
  preview(@Param("projectId") projectId: string, @Body() body: unknown): Promise<GetVideoPromptPreviewResponse> {
    return this.previews.preview(projectId, body);
  }

  @Post(`${API_ROUTES.projects}/:projectId/videos/generations`)
  async start(@Param("projectId") projectId: string, @Body() body: unknown): Promise<StartVideoGenerationResponse> {
    const accepted = await this.submissions.start(projectId, body);
    void this.workflow.run(projectId, accepted.jobId).catch(() => undefined);
    return accepted;
  }

  @Get(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId`)
  progress(@Param("projectId") projectId: string, @Param("jobId") jobId: string): Promise<GenerationProgressResponse> { return this.workflow.getProgress(projectId, jobId); }

  @Post(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/stop`)
  stop(@Param("projectId") projectId: string, @Param("jobId") jobId: string): Promise<GenerationProgressResponse> { return this.workflow.stop(projectId, jobId); }

  @Post(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/restart`)
  restart(@Param("projectId") projectId: string, @Param("jobId") jobId: string): Promise<GenerationProgressResponse> { return this.workflow.restart(projectId, jobId); }

  @Post(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/scenes/:sceneNumber/regenerate`)
  regenerate(@Param("projectId") projectId: string, @Param("jobId") jobId: string, @Param("sceneNumber") sceneNumber: string, @Body() body: unknown): Promise<RegenerateVideoResponse> {
    if (!(typeof body === "object" && body !== null && !Array.isArray(body) && Object.keys(body).length === 1 && (body as { approved?: unknown }).approved === true)) return this.workflow.regenerate(projectId, jobId, []);
    const number = Number(sceneNumber); return this.workflow.regenerate(projectId, jobId, Number.isInteger(number) && String(number) === sceneNumber ? [number as 1 | 2 | 3 | 4 | 5 | 6] : []);
  }

  @Post(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/regenerate-all`)
  regenerateAll(@Param("projectId") projectId: string, @Param("jobId") jobId: string, @Body() body: unknown): Promise<RegenerateVideoResponse> {
    if (!(typeof body === "object" && body !== null && !Array.isArray(body) && Object.keys(body).length === 1 && (body as { approved?: unknown }).approved === true)) return this.workflow.regenerate(projectId, jobId, []);
    return this.workflow.regenerate(projectId, jobId, [1, 2, 3, 4, 5, 6]);
  }

  @Get(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/review`)
  review(@Param("projectId") projectId: string, @Param("jobId") jobId: string): Promise<GetVideoReviewResponse> { return this.workflow.getReview(projectId, jobId); }

  @Post(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/review/:sceneNumber/approve`)
  approveReview(@Param("projectId") projectId: string, @Param("jobId") jobId: string, @Param("sceneNumber") sceneNumber: string, @Body() body: unknown): Promise<ApproveVideoReviewResponse> { return this.workflow.approveReview(projectId, jobId, sceneNumber, body); }

  @Post(`${API_ROUTES.projects}/:projectId/videos/merge`)
  merge(@Param("projectId") projectId: string): Promise<MergeVideosResponse> { return this.mergeService.merge(projectId); }
}
