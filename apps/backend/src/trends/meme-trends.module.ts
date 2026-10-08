import { Module } from "@nestjs/common";

import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { MemeTrendsController } from "./meme-trends.controller.js";
import { MemeTrendsService } from "./meme-trends.service.js";
import { MemeObservationService } from "./meme-observation.service.js";

@Module({
  imports: [AssetsModule, ProviderSettingsModule],
  controllers: [MemeTrendsController],
  providers: [{
    provide: MemeTrendsService,
    useFactory: (root: string, settings: ProviderSettingsService) => new MemeTrendsService(root, settings),
    inject: [LEARNING_DATA_ROOT, ProviderSettingsService],
  }, {
    provide: MemeObservationService,
    useFactory: (root: string, trends: MemeTrendsService, settings: ProviderSettingsService) => new MemeObservationService(root, trends, settings),
    inject: [LEARNING_DATA_ROOT, MemeTrendsService, ProviderSettingsService],
  }],
})
export class MemeTrendsModule {}
