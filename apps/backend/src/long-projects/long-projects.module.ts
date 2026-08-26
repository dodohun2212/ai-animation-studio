import { Module } from "@nestjs/common";
import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { LongProjectsController } from "./long-projects.controller.js";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleController } from "./story-bible.controller.js";
import { StoryBibleService } from "./story-bible.service.js";
import { EpisodeScriptsController } from "./episode-scripts.controller.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeAssetMappingsController } from "./episode-asset-mappings.controller.js";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";
import { EpisodeImagesController } from "./episode-images.controller.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeVideosController } from "./episode-videos.controller.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { EpisodeVideoMergeController } from "./episode-video-merge.controller.js";
import { EpisodeVideoMergeService } from "./episode-video-merge.service.js";
import { EpisodeContinuityController } from "./episode-continuity.controller.js";
import { EpisodeContinuityService } from "./episode-continuity.service.js";
import { EpisodeContinuityReferenceController } from "./episode-continuity-reference.controller.js";
import { EpisodeContinuityReferenceService } from "./episode-continuity-reference.service.js";
import { EpisodeTimelineController } from "./episode-timeline.controller.js";
import { EpisodeTimelineService } from "./episode-timeline.service.js";
import { EpisodeNarrationController } from "./episode-narration.controller.js";
import { EpisodeNarrationService } from "./episode-narration.service.js";

@Module({ imports: [ProjectsModule, AssetsModule, ProviderSettingsModule], controllers: [LongProjectsController, StoryBibleController, EpisodeScriptsController, EpisodeAssetMappingsController, EpisodeImagesController, EpisodeVideosController, EpisodeVideoMergeController, EpisodeContinuityController, EpisodeContinuityReferenceController, EpisodeTimelineController, EpisodeNarrationController], providers: [{ provide: RunwayBudget, useFactory: (root: string) => new RunwayBudget(root), inject: [LEARNING_DATA_ROOT] }, { provide: OpenAiBudget, useFactory: (root: string) => new OpenAiBudget(root), inject: [LEARNING_DATA_ROOT] }, { provide: LongProjectsService, useFactory: (projectsRoot: string, providerSettings: ProviderSettingsService, budget: OpenAiBudget) => new LongProjectsService(projectsRoot, undefined, undefined, undefined, providerSettings, budget), inject: [PROJECTS_ROOT, ProviderSettingsService, OpenAiBudget] }, { provide: StoryBibleService, useFactory: (projectsRoot: string, assets: LocalAssetsRepository) => new StoryBibleService(projectsRoot, assets), inject: [PROJECTS_ROOT] }, { provide: EpisodeScriptsService, useFactory: (projectsRoot: string) => new EpisodeScriptsService(projectsRoot), inject: [PROJECTS_ROOT] }, { provide: EpisodeAssetMappingsService, useFactory: (projectsRoot: string, assets: LocalAssetsRepository) => new EpisodeAssetMappingsService(projectsRoot, assets), inject: [PROJECTS_ROOT, LocalAssetsRepository] }, { provide: EpisodeImagesService, useFactory: (projectsRoot: string, assets: LocalAssetsRepository, mappings: EpisodeAssetMappingsService, providerSettings: ProviderSettingsService, budget: OpenAiBudget) => new EpisodeImagesService(projectsRoot, assets, mappings, providerSettings, budget), inject: [PROJECTS_ROOT, LocalAssetsRepository, EpisodeAssetMappingsService, ProviderSettingsService, OpenAiBudget] }, { provide: EpisodeVideosService, useFactory: (projectsRoot: string, providerSettings: ProviderSettingsService, budget: RunwayBudget) => new EpisodeVideosService(projectsRoot, providerSettings, budget), inject: [PROJECTS_ROOT, ProviderSettingsService, RunwayBudget] }, { provide: EpisodeVideoMergeService, useFactory: (projectsRoot: string) => new EpisodeVideoMergeService(projectsRoot), inject: [PROJECTS_ROOT] }, { provide: EpisodeContinuityService, useFactory: (projectsRoot: string) => new EpisodeContinuityService(projectsRoot), inject: [PROJECTS_ROOT] }, { provide: EpisodeContinuityReferenceService, useFactory: (projectsRoot: string) => new EpisodeContinuityReferenceService(projectsRoot), inject: [PROJECTS_ROOT] }, { provide: EpisodeTimelineService, useFactory: (projectsRoot: string) => new EpisodeTimelineService(projectsRoot), inject: [PROJECTS_ROOT] }, { provide: EpisodeNarrationService, useFactory: (projectsRoot: string, providerSettings: ProviderSettingsService, budget: OpenAiBudget) => new EpisodeNarrationService(projectsRoot, providerSettings, budget), inject: [PROJECTS_ROOT, ProviderSettingsService, OpenAiBudget] }] })
export class LongProjectsModule {}
