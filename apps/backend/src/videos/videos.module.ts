import { Module } from "@nestjs/common";

import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { FontsController } from "./fonts.controller.js";
import { VideosController } from "./videos.controller.js";
import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";
import { LocalVideoWorkflowService } from "./local-video-workflow.service.js";
import { LocalVideoMergeService } from "./video-merge.service.js";
import { VideoLibraryService } from "./video-library.service.js";
import { AudioModule } from "../audio/audio.module.js";
import { AudioLibraryService } from "../audio/audio-library.service.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";

@Module({
  imports: [ProjectsModule, ProviderSettingsModule, AssetsModule, AudioModule],
  controllers: [VideosController, FontsController],
  providers: [
    { provide: RunwayBudget, useFactory: (root: string, settings: ProviderSettingsRepository) => new RunwayBudget(root, undefined, settings), inject: [LEARNING_DATA_ROOT, ProviderSettingsRepository] },
    // The library reports what a project cost, and that is two ledgers: Runway for video, OpenAI for images,
    // scripts and narration. Provided here rather than imported from ImagesModule to keep this module's own
    // wiring readable — the class reads a file path, so a second instance costs nothing.
    { provide: OpenAiBudget, useFactory: (root: string, settings: ProviderSettingsRepository) => new OpenAiBudget(root, undefined, settings), inject: [LEARNING_DATA_ROOT, ProviderSettingsRepository] },
    {
    provide: VideoLibraryService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string, budget: RunwayBudget, openAiBudget: OpenAiBudget) => new VideoLibraryService(projects, projectsRoot, budget, openAiBudget),
    inject: [LocalProjectRepository, PROJECTS_ROOT, RunwayBudget, OpenAiBudget],
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
