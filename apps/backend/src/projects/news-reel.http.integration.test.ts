import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_ROUTES, type NewsReelCard } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { NewsReelController } from "./news-reel.controller.js";
import { NewsReelService } from "./news-reel.service.js";
import { LocalProjectRepository } from "./projects.repository.js";

/**
 * Whether the route is actually reachable at the address the client builds.
 *
 * The service's own tests call `create` directly, which proves the service and says nothing about the path a
 * browser posts to: a controller mounted one segment off answers 404 while every unit test stays green.
 * `route-shape-coverage` compares the decorator's text to `API_ROUTES` and catches a renamed segment, but it
 * reads source rather than starting anything — it cannot see a controller left out of its module.
 *
 * This is also where the refusals stop being exceptions and become status codes, and those are what a screen
 * actually branches on: the photo card's own HTTP test exists because a wrapped exception turned "that name is
 * taken" into "the write failed" for the one screen that had the right sentence (Cowork Round 432).
 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");

const CARD: NewsReelCard = {
  publisher: "연합뉴스",
  headline: { line1: "검찰청 폐지 하루 만에", line2: "후속 법률 51건 통과" },
  caption: { line1: "9월 17일 국회 본회의", line2: null },
  creditRequired: false,
};

const roots: string[] = [];
const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function start() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-reel-http-")); roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const assets = new LocalAssetsRepository(root);
  const asset = await assets.create({ buffer: PNG, originalname: "topic.png", mimetype: "image/png" }, { assetType: "general_reference", displayName: "정치" });
  const service = new NewsReelService(new LocalProjectRepository(projectsRoot), assets, projectsRoot, { warn: () => {} });
  class TestModule {}
  Module({ controllers: [NewsReelController], providers: [{ provide: NewsReelService, useValue: service }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, "127.0.0.1"); apps.push(app);
  return { assetId: asset.asset_id, base: `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}` };
}

describe("making a news reel over HTTP", () => {
  const post = (base: string, body: unknown) =>
    fetch(`${base}${API_ROUTES.newsReels}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("answers at the address the client builds, and sends the card back on the project", async () => {
    const { base, assetId } = await start();

    const response = await post(base, { projectId: "news_one", assetIds: [assetId], card: CARD, clipDurationSeconds: 5, aspectRatio: "9:16" });

    expect(response.status).toBe(201);
    const body = await response.json() as { project?: { id?: string; newsReelCard?: NewsReelCard } };
    expect(body.project?.id).toBe("news_one");
    // 🔴 The screen navigates to the merge screen on this answer; without the card it would be sending
    // somebody to burn an ordinary picture (docs/06_DECISIONS.md D-052).
    expect(body.project?.newsReelCard).toEqual(CARD);
  });

  /**
   * 🔴 400 with the code, not 500 — the boxes are the person's to fix and the screen has a sentence that says
   * so. A refusal arriving as a server error reads as "try again", which is the one thing that cannot work.
   */
  it("refuses a line that does not fit as the request's own fault, with its code", async () => {
    const { base, assetId } = await start();

    const response = await post(base, {
      projectId: "news_two",
      assetIds: [assetId],
      card: { ...CARD, headline: { line1: "가".repeat(16), line2: CARD.headline.line2 } },
      clipDurationSeconds: 5,
      aspectRatio: "9:16",
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { code?: string }).code).toBe("NEWS_REEL_INVALID_REQUEST");
  });

  /** 🟠 같은 이름을 두 번 누르면 「이름이 이미 있다」여야 합니다 — 「저장 못 했다」가 아니라. */
  it("names a taken project name as taken rather than calling it a failed write", async () => {
    const { base, assetId } = await start();
    const body = { projectId: "news_three", assetIds: [assetId], card: CARD, clipDurationSeconds: 5, aspectRatio: "9:16" };

    expect((await post(base, body)).status).toBe(201);
    const second = await post(base, body);

    expect((await second.json() as { code?: string }).code).toBe("PROJECT_ALREADY_EXISTS");
  });
});
