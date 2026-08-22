import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ProviderSettingsModule } from "./settings/provider-settings.module.js";
import { AssetsModule } from "./assets/assets.module.js";
import { ProjectAssetMappingsModule } from "./mappings/mappings.module.js";
import { StoryModule } from "./story/story.module.js";
import { ImagesModule } from "./images/images.module.js";
import { VideosModule } from "./videos/videos.module.js";

@Module({ imports: [ProjectsModule, ProviderSettingsModule, AssetsModule, ProjectAssetMappingsModule, StoryModule, ImagesModule, VideosModule], controllers: [HealthController] })
export class AppModule {}
