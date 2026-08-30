import { Module } from "@nestjs/common";
import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { ProjectsModule, PROJECTS_ROOT } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { NarrationController } from "./narration.controller.js";
import { LocalNarrationGenerationService } from "./local-narration-generation.service.js";
import { NarrationReviewService } from "./narration-review.service.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";

@Module({
  imports: [ProjectsModule, AssetsModule, ProviderSettingsModule],
  controllers: [NarrationController],
  providers: [
    { provide: OpenAiBudget, useFactory: (root: string) => new OpenAiBudget(root), inject: [LEARNING_DATA_ROOT] },
    {
      provide: LocalNarrationGenerationService,
      useFactory: (projects: LocalProjectRepository, projectsRoot: string, providerSettings: ProviderSettingsService, budget: OpenAiBudget) =>
        new LocalNarrationGenerationService(projects, projectsRoot, undefined, providerSettings, budget),
      inject: [LocalProjectRepository, PROJECTS_ROOT, ProviderSettingsService, OpenAiBudget],
    }, {
      provide: NarrationReviewService,
      useFactory: (projects: LocalProjectRepository, generation: LocalNarrationGenerationService, providerSettings: ProviderSettingsService, budget: OpenAiBudget, assets: LocalAssetsRepository) =>
        new NarrationReviewService(projects, generation, providerSettings, budget, undefined, assets),
      inject: [LocalProjectRepository, LocalNarrationGenerationService, ProviderSettingsService, OpenAiBudget, LocalAssetsRepository],
    },
  ],
})
export class NarrationModule {}
