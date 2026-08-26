import * as path from "node:path";

import { Module } from "@nestjs/common";

import { ProviderSettingsController } from "./provider-settings.controller.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";
import { ProviderSettingsService } from "./provider-settings.service.js";

export const PROVIDER_SETTINGS_ROOT = "PROVIDER_SETTINGS_ROOT";

/**
 * Deliberately fails closed instead of defaulting to process.cwd(): this directory holds the real, saved Runway/
 * OpenAI credential. A silent process.cwd() fallback meant anything run from apps/backend -- a one-off script, a
 * debug tool, a migration, `node -e`, a test that forgot to isolate itself -- picked up the real key with no
 * warning (`.claude-bridge` Round 156/157/158: this is exactly how a backend test suite run ended up making real,
 * billed Runway calls). The one legitimate entry point, main.ts, sets this env var explicitly before bootstrap;
 * every other entry point (including every test that boots the real AppModule) must now do the same or fail
 * loudly, instead of silently reaching a real credential.
 */
function requiredProviderSettingsRoot(): string {
  const root = process.env.PROVIDER_SETTINGS_ROOT;
  if (!root) {
    throw new Error(
      "PROVIDER_SETTINGS_ROOT is not set. Refusing to default to process.cwd(), which could be a real credential " +
      "directory. Set it explicitly (main.ts does this for real backend startup; a test must set its own isolated directory).",
    );
  }
  return path.resolve(root);
}

@Module({
  controllers: [ProviderSettingsController],
  providers: [
    { provide: PROVIDER_SETTINGS_ROOT, useFactory: requiredProviderSettingsRoot },
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
