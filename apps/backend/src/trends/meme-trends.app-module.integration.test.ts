import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, expect, it } from "vitest";
import { API_ROUTES } from "@ai-animation-studio/shared";

import { AppModule } from "../app.module.js";
import { groupMemeCandidates } from "./meme-trends.service.js";

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

it("wires the saved observation workspace and manual card routes without a provider key", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "meme-workspace-http-"));
  priorLearningRoot = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  priorSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
  const observedAt = new Date().toISOString();
  const trends = groupMemeCandidates(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((id, i) => ({
    id, snippet: { title: "#니코니코니", channelId: `channel-${i}`, publishedAt: observedAt },
    statistics: { viewCount: "10000" }, contentDetails: { duration: "PT30S" },
  })), observedAt);
  await fs.writeFile(path.join(root, "meme_trends_youtube.json"), JSON.stringify({ source: "youtube", regionCode: "KR", collectedAt: observedAt, trends }));
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const trendId = trends[0]!.id;
  const workspace = await fetch(`${base}${API_ROUTES.memeTrendWorkspace(trendId)}`);
  expect(workspace.status).toBe(200);
  expect(await workspace.json()).toMatchObject({ trendId, cards: [], dailyCalls: { used: 0, limit: 3 } });
  const save = await fetch(`${base}${API_ROUTES.memeTrendCards(trendId)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedCardsSavedAt: null, cards: [{ kind: "line", text: "내 대사", startSeconds: null, endSeconds: null, origin: "manual", sourceVideoId: null }] }),
  });
  expect(save.status).toBe(200);
  expect(await save.json()).toMatchObject({ cards: [{ text: "내 대사" }] });
  const analyze = await fetch(`${base}${API_ROUTES.memeTrendAnalysis(trendId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceVideoId: "aaaaaaaaaaa" }),
  });
  expect(analyze.status).toBe(400);
  expect(await analyze.json()).toMatchObject({ code: "MEME_ANALYSIS_KEY_MISSING" });
  expect(await fs.readdir(root)).not.toContain("meme_analysis_call_usage.json");
});
