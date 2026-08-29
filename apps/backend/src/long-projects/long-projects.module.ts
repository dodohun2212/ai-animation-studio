import { Module } from "@nestjs/common";
import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { AudioModule } from "../audio/audio.module.js";
import { AudioLibraryService } from "../audio/audio-library.service.js";
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
import { OrphanedEpisodeGenerationRecoveryService } from "./orphaned-episode-generation-recovery.service.js";
import { ProjectAssetMappingsModule } from "../mappings/mappings.module.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { EpisodeMappingOwners, type EpisodeMappingKey } from "./episode-mapping-owner.js";
import { EPISODE_ASSET_MAPPINGS, EpisodeAssetMappingsFlowController } from "./episode-mappings.controller.js";

@Module({ imports: [ProjectsModule, AssetsModule, ProviderSettingsModule, ProjectAssetMappingsModule, AudioModule], controllers: [LongProjectsController, StoryBibleController, EpisodeScriptsController, EpisodeAssetMappingsFlowController, EpisodeImagesController, EpisodeVideosController, EpisodeVideoMergeController, EpisodeContinuityController, EpisodeContinuityReferenceController, EpisodeTimelineController, EpisodeNarrationController], providers: [
  {
    // The short project's mapping service, pointed at an Episode. Nothing about the flow is re-implemented
    // here: an Episode supplies where its files live and where its four facts are kept, and the rest — manual
    // linking, Folders, scene-level scope — is behaviour that already existed and had simply never been
    // reachable from an Episode (docs/02_MIGRATION_PLAN.md, asset model rounds).
    provide: EPISODE_ASSET_MAPPINGS,
    useFactory: (repository: LocalProjectAssetMappingsRepository, assets: LocalAssetsRepository, projectsRoot: string) =>
      new ProjectAssetMappingsService<EpisodeMappingKey>(repository, assets, new EpisodeMappingOwners(projectsRoot)),
    inject: [LocalProjectAssetMappingsRepository, LocalAssetsRepository, PROJECTS_ROOT],
  },{ provide: RunwayBudget, useFactory: (root: string) => new RunwayBudget(root), inject: [LEARNING_DATA_ROOT] }, { provide: OpenAiBudget, useFactory: (root: string) => new OpenAiBudget(root), inject: [LEARNING_DATA_ROOT] }, { provide: LongProjectsService, useFactory: (projectsRoot: string, providerSettings: ProviderSettingsService, budget: OpenAiBudget) => new LongProjectsService(projectsRoot, undefined, undefined, undefined, providerSettings, budget), inject: [PROJECTS_ROOT, ProviderSettingsService, OpenAiBudget] }, { provide: StoryBibleService, useFactory: (projectsRoot: string, assets: LocalAssetsRepository) => new StoryBibleService(projectsRoot, assets), inject: [PROJECTS_ROOT] }, { provide: EpisodeScriptsService, useFactory: (projectsRoot: string, providerSettings: ProviderSettingsService, budget: OpenAiBudget) => new EpisodeScriptsService(projectsRoot, providerSettings, budget), inject: [PROJECTS_ROOT, ProviderSettingsService, OpenAiBudget] }, { provide: EpisodeImagesService, useFactory: (projectsRoot: string, assets: LocalAssetsRepository, mappingStore: LocalProjectAssetMappingsRepository, providerSettings: ProviderSettingsService, budget: OpenAiBudget) => new EpisodeImagesService(projectsRoot, assets, mappingStore, new EpisodeMappingOwners(projectsRoot), providerSettings, budget), inject: [PROJECTS_ROOT, LocalAssetsRepository, LocalProjectAssetMappingsRepository, ProviderSettingsService, OpenAiBudget] }, { provide: EpisodeVideosService, useFactory: (projectsRoot: string, providerSettings: ProviderSettingsService, budget: RunwayBudget) => new EpisodeVideosService(projectsRoot, providerSettings, budget), inject: [PROJECTS_ROOT, ProviderSettingsService, RunwayBudget] }, { provide: EpisodeVideoMergeService, useFactory: (projectsRoot: string, audioLibrary: AudioLibraryService) => new EpisodeVideoMergeService(projectsRoot, undefined, audioLibrary), inject: [PROJECTS_ROOT, AudioLibraryService] }, { provide: EpisodeContinuityService, useFactory: (projectsRoot: string) => new EpisodeContinuityService(projectsRoot), inject: [PROJECTS_ROOT] }, { provide: EpisodeContinuityReferenceService, useFactory: (projectsRoot: string) => new EpisodeContinuityReferenceService(projectsRoot), inject: [PROJECTS_ROOT] }, { provide: EpisodeTimelineService, useFactory: (projectsRoot: string) => new EpisodeTimelineService(projectsRoot), inject: [PROJECTS_ROOT] }, { provide: EpisodeNarrationService, useFactory: (projectsRoot: string, providerSettings: ProviderSettingsService, budget: OpenAiBudget) => new EpisodeNarrationService(projectsRoot, providerSettings, budget), inject: [PROJECTS_ROOT, ProviderSettingsService, OpenAiBudget] }, { provide: OrphanedEpisodeGenerationRecoveryService, useFactory: (projectsRoot: string) => new OrphanedEpisodeGenerationRecoveryService(projectsRoot), inject: [PROJECTS_ROOT] }] })
export class LongProjectsModule {}
