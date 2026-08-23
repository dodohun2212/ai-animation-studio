import * as path from "node:path";

import { Module } from "@nestjs/common";

import { ProviderSettingsController } from "./provider-settings.controller.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";
import { ProviderSettingsService } from "./provider-settings.service.js";

export const PROVIDER_SETTINGS_ROOT = "PROVIDER_SETTINGS_ROOT";

@Module({
  controllers: [ProviderSettingsController],
  providers: [
    { provide: PROVIDER_SETTINGS_ROOT, useFactory: () => path.resolve(process.env.PROVIDER_SETTINGS_ROOT ?? process.cwd()) },
    {
      provide: ProviderSettingsRepository,
      useFactory: (root: string) => new ProviderSettingsRepository(root),
      inject: [PROVIDER_SETTINGS_ROOT],
    },
    ProviderSettingsService,
  ],
  exports: [ProviderSettingsService, ProviderSettingsRepository],
})
export class ProviderSettingsModule {}
