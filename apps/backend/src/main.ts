import { NestFactory } from "@nestjs/core";
import type { Express } from "express";

import { AppModule } from "./app.module.js";
import { serveFrontend } from "./static-frontend.js";

async function bootstrap(): Promise<void> {
  // The one legitimate default, and it is only safe because every other launcher now sets this explicitly.
  // `npm run dev:backend` runs with apps/backend as its working directory, which is exactly where the saved
  // credential belongs; the desktop shell passes its own root rather than relying on this. That distinction is
  // the whole fix: while the shell left it unset, this line silently gave it a different drawer from the browser
  // dev server, and a key entered in one was invisible in the other. See ProviderSettingsModule's
  // requiredProviderSettingsRoot doc comment for why it refuses to guess when nothing sets it at all.
  process.env.PROVIDER_SETTINGS_ROOT ??= process.cwd();
  const app = await NestFactory.create(AppModule);
  const frontendDirectory = process.env.FRONTEND_STATIC_DIR;
  if (frontendDirectory) serveFrontend(app.getHttpAdapter().getInstance() as Express, frontendDirectory);
  await app.listen(process.env.PORT ?? 3000, "127.0.0.1");
}

void bootstrap();
