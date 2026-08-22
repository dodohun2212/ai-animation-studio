import { Module } from "@nestjs/common";

import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { VideosController } from "./videos.controller.js";
import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";
import { LocalVideoWorkflowService } from "./local-video-workflow.service.js";
import { LocalVideoMergeService } from "./video-merge.service.js";

@Module({
  imports: [ProjectsModule],
  controllers: [VideosController],
  providers: [{
    provide: LocalVideoPreviewService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string) => new LocalVideoPreviewService(projects, projectsRoot),
    inject: [LocalProjectRepository, PROJECTS_ROOT],
  }, {
    provide: LocalVideoSubmissionService,
    useFactory: (projects: LocalProjectRepository, previews: LocalVideoPreviewService) => new LocalVideoSubmissionService(projects, previews),
    inject: [LocalProjectRepository, LocalVideoPreviewService],
  }, {
    provide: LocalVideoWorkflowService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string) => new LocalVideoWorkflowService(projects, projectsRoot),
    inject: [LocalProjectRepository, PROJECTS_ROOT],
  }, {
    provide: LocalVideoMergeService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string) => new LocalVideoMergeService(projects, projectsRoot),
    inject: [LocalProjectRepository, PROJECTS_ROOT],
  }],
})
export class VideosModule {}
