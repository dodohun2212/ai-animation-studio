import { Module } from "@nestjs/common";

import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { VideosController } from "./videos.controller.js";
import { LocalVideoPreviewService } from "./video-preview.service.js";

@Module({
  imports: [ProjectsModule],
  controllers: [VideosController],
  providers: [{
    provide: LocalVideoPreviewService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string) => new LocalVideoPreviewService(projects, projectsRoot),
    inject: [LocalProjectRepository, PROJECTS_ROOT],
  }],
})
export class VideosModule {}
