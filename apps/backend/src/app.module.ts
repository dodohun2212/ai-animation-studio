import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { HealthController } from "./health.controller.js";
import { UnexpectedErrorFilter } from "./unexpected-error.filter.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { FlowerCardModule } from "./projects/flower-card.module.js";
import { ProviderSettingsModule } from "./settings/provider-settings.module.js";
import { AssetsModule } from "./assets/assets.module.js";
import { ProjectAssetMappingsModule } from "./mappings/mappings.module.js";
import { StoryModule } from "./story/story.module.js";
import { ImagesModule } from "./images/images.module.js";
import { VideosModule } from "./videos/videos.module.js";
import { LongProjectsModule } from "./long-projects/long-projects.module.js";
import { NarrationModule } from "./narration/narration.module.js";
import { AudioModule } from "./audio/audio.module.js";
import { InstagramModule } from "./instagram/instagram.module.js";

@Module({ imports: [ProjectsModule, FlowerCardModule, ProviderSettingsModule, AssetsModule, ProjectAssetMappingsModule, StoryModule, ImagesModule, VideosModule, LongProjectsModule, NarrationModule, AudioModule, InstagramModule], controllers: [HealthController], providers: [{ provide: APP_FILTER, useClass: UnexpectedErrorFilter }] })
export class AppModule {}
