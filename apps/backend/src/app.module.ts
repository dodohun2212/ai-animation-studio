import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ProviderSettingsModule } from "./settings/provider-settings.module.js";

@Module({ imports: [ProjectsModule, ProviderSettingsModule], controllers: [HealthController] })
export class AppModule {}
