import * as path from "node:path";

import { Module } from "@nestjs/common";

import { ProviderSettingsController } from "./provider-settings.controller.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";
import { ProviderSettingsService } from "./provider-settings.service.js";

export const PROVIDER_SETTINGS_ROOT = "PROVIDER_SETTINGS_ROOT";

@Module({
  controllers: [ProviderSettingsController],
  providers: [
    { provide: PROVIDER_SETTINGS_ROOT, useValue: path.resolve(process.cwd()) },
    {
      provide: ProviderSettingsRepository,
      useFactory: (root: string) => new ProviderSettingsRepository(root),
      inject: [PROVIDER_SETTINGS_ROOT],
    },
    ProviderSettingsService,
  ],
})
export class ProviderSettingsModule {}
