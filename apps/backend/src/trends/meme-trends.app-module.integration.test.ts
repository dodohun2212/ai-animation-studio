import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, expect, it } from "vitest";
import { API_ROUTES } from "@ai-animation-studio/shared";

import { AppModule } from "../app.module.js";

let app: INestApplication | undefined;
let root: string | undefined;
let priorLearningRoot: string | undefined;
let priorSettingsRoot: string | undefined;

afterEach(async () => {
  await app?.close(); app = undefined;
  if (priorLearningRoot === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = priorLearningRoot;
  if (priorSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT; else process.env.PROVIDER_SETTINGS_ROOT = priorSettingsRoot;
  priorLearningRoot = undefined; priorSettingsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); root = undefined;
});

it("wires the read-only meme feed and refuses collection before any external request without a key", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "meme-trends-http-"));
  priorLearningRoot = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  priorSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const list = await fetch(`${base}${API_ROUTES.memeTrends}`);
  expect(list.status).toBe(200);
  expect(await list.json()).toEqual({ source: "youtube", regionCode: "KR", collectedAt: null, trends: [] });
  const refresh = await fetch(`${base}${API_ROUTES.memeTrendsRefresh}`, { method: "POST" });
  expect(refresh.status).toBe(400);
  expect(await refresh.json()).toMatchObject({ code: "MEME_TREND_KEY_MISSING" });
});
