import { NestFactory } from "@nestjs/core";
import type { Express } from "express";

import { AppModule } from "./app.module.js";
import { serveFrontend } from "./static-frontend.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const frontendDirectory = process.env.FRONTEND_STATIC_DIR;
  if (frontendDirectory) serveFrontend(app.getHttpAdapter().getInstance() as Express, frontendDirectory);
  await app.listen(process.env.PORT ?? 3000, "127.0.0.1");
}

void bootstrap();
