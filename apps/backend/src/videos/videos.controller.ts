import * as fs from "node:fs/promises";
import { Body, Controller, Get, HttpException, Param, Post, Res, StreamableFile } from "@nestjs/common";
import { API_ROUTES, type ApproveVideoReviewResponse, type GenerationProgressResponse, type GetVideoLibraryResponse, type GetVideoPromptPreviewResponse, type GetVideoReviewResponse, type GetVideoVersionsResponse, type MergeVideosResponse, type RecoverVideosResponse, type RegenerateVideoResponse, type RestoreVideoVersionResponse, type SceneNumber, type StartVideoGenerationResponse } from "@ai-animation-studio/shared";

import { videoContentUnavailable } from "./video-workflow-api.error.js";
import { videoMergeContentUnavailable } from "./video-merge-api.error.js";
import { videoLibraryContentUnavailable } from "./video-library-api.error.js";
import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";
import { LocalVideoWorkflowService } from "./local-video-workflow.service.js";
import { LocalVideoMergeService } from "./video-merge.service.js";
import { VideoLibraryService } from "./video-library.service.js";

interface HttpResponse { type(value: string): void; setHeader(name: string, value: string): void }

/** Same lenient "not the expected shape → treat as no-op" fallback this controller already used for regenerate before additionalInstruction existed — see the two routes below. */
function parseRegenerateBody(body: unknown): { additionalInstruction?: string } | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const record = body as { approved?: unknown; additionalInstruction?: unknown };
  if (record.approved !== true) return undefined;
  if (Object.keys(record).some((key) => key !== "approved" && key !== "additionalInstruction")) return undefined;
  if (record.additionalInstruction !== undefined && typeof record.additionalInstruction !== "string") return undefined;
  const trimmed = typeof record.additionalInstruction === "string" ? record.additionalInstruction.trim() : "";
  return { ...(trimmed ? { additionalInstruction: trimmed } : {}) };
}

@Controller()
export class VideosController {
  constructor(private readonly previews: LocalVideoPreviewService, private readonly submissions: LocalVideoSubmissionService, private readonly workflow: LocalVideoWorkflowService, private readonly mergeService: LocalVideoMergeService, private readonly library: VideoLibraryService) {}

  @Get(API_ROUTES.videoLibrary)
  videoLibrary(): Promise<GetVideoLibraryResponse> { return this.library.list(); }

  @Get(`${API_ROUTES.projects}/:projectId/videos/:sceneNumber/versions`)
  videoVersions(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string): Promise<GetVideoVersionsResponse> {
    return this.library.versions(projectId, sceneNumber);
  }

  @Get(`${API_ROUTES.projects}/:projectId/videos/:sceneNumber/versions/:versionId/content`)
  async videoVersionContent(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Param("versionId") versionId: string, @Res({ passthrough: true }) response: HttpResponse): Promise<StreamableFile> {
    const content = await this.library.content(projectId, sceneNumber, versionId);
    try {
      const handle = await fs.open(content.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); throw videoLibraryContentUnavailable(); }
      response.type("video/mp4");
      response.setHeader("Content-Disposition", `inline; filename="${sceneNumber}_${versionId}.mp4"`);
      response.setHeader("Content-Length", String(stat.size));
      response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(handle.createReadStream());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw videoLibraryContentUnavailable();
    }
  }

  @Post(`${API_ROUTES.projects}/:projectId/videos/:sceneNumber/versions/:versionId/restore`)
  videoVersionRestore(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Param("versionId") versionId: string, @Body() body: unknown): Promise<RestoreVideoVersionResponse> {
    return this.library.restore(projectId, sceneNumber, versionId, body);
  }

  @Post(`${API_ROUTES.projects}/:projectId/videos/preview`)
  preview(@Param("projectId") projectId: string, @Body() body: unknown): Promise<GetVideoPromptPreviewResponse> {
    return this.previews.preview(projectId, body);
  }

  // Registered before the :sceneNumber route below so the literal "final" segment is
  // matched here first, rather than being parsed as a (necessarily invalid) scene number.
  @Get(`${API_ROUTES.projects}/:projectId/videos/final/content`)
  async finalContent(@Param("projectId") projectId: string, @Res({ passthrough: true }) response: HttpResponse): Promise<StreamableFile> {
    const content = await this.mergeService.content(projectId);
    try {
      const handle = await fs.open(content.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); throw videoMergeContentUnavailable(); }
      response.type("video/mp4");
      response.setHeader("Content-Disposition", `inline; filename="instagram_reel.mp4"`);
      response.setHeader("Content-Length", String(stat.size));
      response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(handle.createReadStream());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw videoMergeContentUnavailable();
    }
  }

  @Get(`${API_ROUTES.projects}/:projectId/videos/:sceneNumber/content`)
  async content(@Param("projectId") projectId: string, @Param("sceneNumber") sceneNumber: string, @Res({ passthrough: true }) response: HttpResponse): Promise<StreamableFile> {
    const content = await this.workflow.content(projectId, sceneNumber);
    try {
      const handle = await fs.open(content.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); throw videoContentUnavailable(); }
      response.type("video/mp4");
      response.setHeader("Content-Disposition", `inline; filename="scene${sceneNumber}.mp4"`);
      response.setHeader("Content-Length", String(stat.size));
      response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(handle.createReadStream());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw videoContentUnavailable();
    }
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
    const parsed = parseRegenerateBody(body);
    if (!parsed) return this.workflow.regenerate(projectId, jobId, []);
    const number = Number(sceneNumber);
    return this.workflow.regenerate(projectId, jobId, Number.isInteger(number) && String(number) === sceneNumber ? [number as SceneNumber] : [], parsed.additionalInstruction);
  }

  @Post(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/regenerate-all`)
  async regenerateAll(@Param("projectId") projectId: string, @Param("jobId") jobId: string, @Body() body: unknown): Promise<RegenerateVideoResponse> {
    const parsed = parseRegenerateBody(body);
    if (!parsed) return this.workflow.regenerate(projectId, jobId, []);
    const scenes = await this.workflow.jobSceneNumbers(projectId, jobId);
    return this.workflow.regenerate(projectId, jobId, scenes, parsed.additionalInstruction);
  }

  /** Re-fetches this job's already-paid Runway outputs for scenes left holding a placeholder. Never generates. */
  @Post(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/recovery`)
  recover(@Param("projectId") projectId: string, @Param("jobId") jobId: string, @Body() body: unknown): Promise<RecoverVideosResponse> {
    return this.workflow.recover(projectId, jobId, body);
  }

  @Get(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/review`)
  review(@Param("projectId") projectId: string, @Param("jobId") jobId: string): Promise<GetVideoReviewResponse> { return this.workflow.getReview(projectId, jobId); }

  @Post(`${API_ROUTES.projects}/:projectId/videos/generations/:jobId/review/:sceneNumber/approve`)
  approveReview(@Param("projectId") projectId: string, @Param("jobId") jobId: string, @Param("sceneNumber") sceneNumber: string, @Body() body: unknown): Promise<ApproveVideoReviewResponse> { return this.workflow.approveReview(projectId, jobId, sceneNumber, body); }

  @Post(`${API_ROUTES.projects}/:projectId/videos/merge`)
  merge(@Param("projectId") projectId: string, @Body() body: unknown): Promise<MergeVideosResponse> { return this.mergeService.merge(projectId, body); }
}
