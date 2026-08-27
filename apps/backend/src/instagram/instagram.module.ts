import { Module } from "@nestjs/common";

import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { InstagramTargetsController } from "./instagram-targets.controller.js";
import { InstagramTargetsService } from "./instagram-targets.service.js";

@Module({
  imports: [AssetsModule, ProviderSettingsModule],
  controllers: [InstagramTargetsController],
  providers: [
    {
      provide: InstagramTargetsService,
      useFactory: (root: string, settings: ProviderSettingsService) => new InstagramTargetsService(root, settings),
      inject: [LEARNING_DATA_ROOT, ProviderSettingsService],
    },
  ],
  exports: [InstagramTargetsService],
})
export class InstagramModule {}
