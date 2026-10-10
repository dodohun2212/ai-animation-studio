import { Module } from "@nestjs/common";
import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { ProjectAssetMappingsModule } from "../mappings/mappings.module.js";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { StoryPromptController } from "./story-prompt.controller.js";
import { StoryPromptService } from "./story-prompt.service.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { StoryAnalysisService } from "./story-analysis.service.js";
import { NovelCharacterImageService } from "./novel-character-image.service.js";
import { NovelSourceService } from "./novel-source.service.js";
import { NovelSourceHttpClient } from "../providers/novel-source-http.client.js";

@Module({
  imports: [ProjectsModule, ProjectAssetMappingsModule, ProviderSettingsModule, AssetsModule],
  controllers: [StoryPromptController],
  providers: [
    NovelSourceService,
    NovelSourceHttpClient,
    { provide: OpenAiBudget, useFactory: (root: string, settings: ProviderSettingsRepository) => new OpenAiBudget(root, undefined, settings), inject: [LEARNING_DATA_ROOT, ProviderSettingsRepository] },
    {
      provide: StoryPromptService,
      useFactory: (projects: LocalProjectRepository, mappings: ProjectAssetMappingsService, providerSettings: ProviderSettingsService, budget: OpenAiBudget, assets: LocalAssetsRepository) =>
        new StoryPromptService(projects, undefined, mappings, providerSettings, budget, assets),
      inject: [LocalProjectRepository, ProjectAssetMappingsService, ProviderSettingsService, OpenAiBudget, LocalAssetsRepository],
    },
    {
      provide: StoryAnalysisService,
      useFactory: (root: string, providerSettings: ProviderSettingsService, budget: OpenAiBudget) => new StoryAnalysisService(root, providerSettings, budget),
      inject: [LEARNING_DATA_ROOT, ProviderSettingsService, OpenAiBudget],
    },
    {
      provide: NovelCharacterImageService,
      useFactory: (root: string, assets: LocalAssetsRepository, providerSettings: ProviderSettingsService, budget: OpenAiBudget) =>
        new NovelCharacterImageService(root, assets, providerSettings, budget),
      inject: [LEARNING_DATA_ROOT, LocalAssetsRepository, ProviderSettingsService, OpenAiBudget],
    },
  ],
})
export class StoryModule {}
