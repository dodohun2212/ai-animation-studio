import { Module } from "@nestjs/common";

import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { VideosController } from "./videos.controller.js";
import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";

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
  }],
})
export class VideosModule {}
