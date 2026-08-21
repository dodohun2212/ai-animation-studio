import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ProviderSettingsModule } from "./settings/provider-settings.module.js";
import { AssetsModule } from "./assets/assets.module.js";
import { ProjectAssetMappingsModule } from "./mappings/mappings.module.js";

@Module({ imports: [ProjectsModule, ProviderSettingsModule, AssetsModule, ProjectAssetMappingsModule], controllers: [HealthController] })
export class AppModule {}
