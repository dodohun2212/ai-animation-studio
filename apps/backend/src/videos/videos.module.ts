import { Module } from "@nestjs/common";

import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { VideosController } from "./videos.controller.js";
import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";
import { LocalVideoWorkflowService } from "./local-video-workflow.service.js";
import { LocalVideoMergeService } from "./video-merge.service.js";
import { VideoLibraryService } from "./video-library.service.js";
import { AudioModule } from "../audio/audio.module.js";
import { AudioLibraryService } from "../audio/audio-library.service.js";

@Module({
  imports: [ProjectsModule, ProviderSettingsModule, AssetsModule, AudioModule],
  controllers: [VideosController],
  providers: [
    { provide: RunwayBudget, useFactory: (root: string) => new RunwayBudget(root), inject: [LEARNING_DATA_ROOT] },
    {
    provide: VideoLibraryService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string, budget: RunwayBudget) => new VideoLibraryService(projects, projectsRoot, budget),
    inject: [LocalProjectRepository, PROJECTS_ROOT, RunwayBudget],
  }, {
    provide: LocalVideoPreviewService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string, budget: RunwayBudget) => new LocalVideoPreviewService(projects, projectsRoot, budget),
    inject: [LocalProjectRepository, PROJECTS_ROOT, RunwayBudget],
  }, {
    provide: LocalVideoSubmissionService,
    useFactory: (projects: LocalProjectRepository, previews: LocalVideoPreviewService, providerSettings: ProviderSettingsService, budget: RunwayBudget) =>
      new LocalVideoSubmissionService(projects, previews, undefined, providerSettings, budget),
    inject: [LocalProjectRepository, LocalVideoPreviewService, ProviderSettingsService, RunwayBudget],
  }, {
    provide: LocalVideoWorkflowService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string, providerSettings: ProviderSettingsService, budget: RunwayBudget) =>
      new LocalVideoWorkflowService(projects, projectsRoot, providerSettings, budget),
    inject: [LocalProjectRepository, PROJECTS_ROOT, ProviderSettingsService, RunwayBudget],
  }, {
    provide: LocalVideoMergeService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string, audioLibrary: AudioLibraryService) => new LocalVideoMergeService(projects, projectsRoot, undefined, audioLibrary),
    inject: [LocalProjectRepository, PROJECTS_ROOT, AudioLibraryService],
  }],
})
export class VideosModule {}
