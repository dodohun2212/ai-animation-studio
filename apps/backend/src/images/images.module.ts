import { Module } from "@nestjs/common";
import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { ProjectAssetMappingsModule } from "../mappings/mappings.module.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProjectsModule, PROJECTS_ROOT } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { ImagesController } from "./images.controller.js";
import { LocalImageGenerationService } from "./local-image-generation.service.js";
import { ImageReviewService } from "./image-review.service.js";

@Module({
  imports: [ProjectsModule, ProjectAssetMappingsModule, AssetsModule, ProviderSettingsModule],
  controllers: [ImagesController],
  providers: [
    { provide: OpenAiBudget, useFactory: (root: string) => new OpenAiBudget(root), inject: [LEARNING_DATA_ROOT] },
    {
      provide: LocalImageGenerationService,
      useFactory: (projects: LocalProjectRepository, mappings: LocalProjectAssetMappingsRepository, projectsRoot: string, assets: LocalAssetsRepository, providerSettings: ProviderSettingsService, budget: OpenAiBudget) =>
        new LocalImageGenerationService(projects, mappings, projectsRoot, undefined, assets, providerSettings, budget),
      inject: [LocalProjectRepository, LocalProjectAssetMappingsRepository, PROJECTS_ROOT, LocalAssetsRepository, ProviderSettingsService, OpenAiBudget],
    }, {
      provide: ImageReviewService,
      useFactory: (projects: LocalProjectRepository, projectsRoot: string, assets: LocalAssetsRepository) => new ImageReviewService(projects, projectsRoot, assets),
      inject: [LocalProjectRepository, PROJECTS_ROOT, LocalAssetsRepository],
    },
  ],
})
export class ImagesModule {}
