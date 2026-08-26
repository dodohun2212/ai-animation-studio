import { NestFactory } from "@nestjs/core";
import type { Express } from "express";

import { AppModule } from "./app.module.js";
import { serveFrontend } from "./static-frontend.js";

async function bootstrap(): Promise<void> {
  // The one legitimate default: real backend startup, with no explicit override, keeps today's behavior (the
  // saved credential lives alongside wherever this process was launched from). See ProviderSettingsModule's
  // requiredProviderSettingsRoot doc comment for why every other entry point must set this explicitly instead.
  process.env.PROVIDER_SETTINGS_ROOT ??= process.cwd();
  const app = await NestFactory.create(AppModule);
  const frontendDirectory = process.env.FRONTEND_STATIC_DIR;
  if (frontendDirectory) serveFrontend(app.getHttpAdapter().getInstance() as Express, frontendDirectory);
  await app.listen(process.env.PORT ?? 3000, "127.0.0.1");
}

void bootstrap();
