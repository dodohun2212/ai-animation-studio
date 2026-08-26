import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "./app.module.js";

interface ExpressLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

describe("AppModule", () => {
  let close: (() => Promise<void>) | undefined;
  let settingsRoot: string | undefined;
  let previousSettingsRoot: string | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
    if (previousSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT;
    else process.env.PROVIDER_SETTINGS_ROOT = previousSettingsRoot;
    previousSettingsRoot = undefined;
    if (settingsRoot) await fs.rm(settingsRoot, { recursive: true, force: true });
    settingsRoot = undefined;
  });

  it("initializes Nest and registers all provider settings routes", async () => {
    settingsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "app-module-settings-"));
    previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT;
    process.env.PROVIDER_SETTINGS_ROOT = settingsRoot;
    const app = await NestFactory.create(AppModule, { logger: false });
    close = () => app.close();

    await app.init();

    const express = app.getHttpAdapter().getInstance() as { router: { stack: ExpressLayer[] } };
    const routes = express.router.stack.flatMap((layer) => {
      if (!layer.route) return [];
      return Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route?.path}`);
    });

    expect(routes).toEqual(expect.arrayContaining([
      "GET /settings/providers",
      "PUT /settings/providers/:provider/credential",
      "POST /settings/providers/:provider/disconnect",
      "POST /settings/providers/:provider/reconnect",
      "GET /assets",
      "POST /assets",
      "GET /assets/:assetId",
      "GET /assets/:assetId/content",
      "PATCH /assets/:assetId",
      "DELETE /assets/:assetId",
      "GET /long-projects/:projectId/story-bible",
      "POST /long-projects/:projectId/story-bible/:collection",
      "PATCH /long-projects/:projectId/story-bible/:collection/:itemId",
      "DELETE /long-projects/:projectId/story-bible/:collection/:itemId",
    ]));
  });
});
