import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_ROUTES } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { NewsCallQuota } from "./news-call-quota.js";
import { NewsController } from "./news.controller.js";

/**
 * Whether the card-text route is reachable, and whether its refusals arrive as the codes a screen branches on.
 *
 * The controller's own tests call `cardText` directly — which proves the five steps and says nothing about the
 * address a browser posts to, or about what a thrown `NewsApiException` turns into on the wire. Those two are
 * where this feature has already been wrong twice for other routes.
 *
 * No provider is reached: `callCardProvider` is a replaceable field for exactly this reason, and the settings
 * repository here answers from memory rather than disk.
 */
const roots: string[] = [];
const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const ARTICLE = {
  title: "물가 상승률 3.2%로 둔화",
  body: "통계청은 3.2%라고 밝혔다. ".repeat(40),
  publisher: "연합뉴스",
  publishedAt: "2026-09-19T09:00:00+09:00",
  sourceUrl: "https://www.yna.co.kr/view/1",
};

async function start(key: string | null, answer: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-card-http-")); roots.push(root);
  class TestModule {}
  Module({
    controllers: [NewsController],
    providers: [
      { provide: NewsCallQuota, useValue: new NewsCallQuota(root) },
      { provide: ProviderSettingsRepository, useValue: { read: async () => key } },
    ],
  })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  // 🟠 Nest builds the controller, so the provider hook is replaced on the instance it built — replacing the
  // controller itself would mean Nest never resolving its dependencies, which is half of what this checks.
  app.get(NewsController).callCardProvider = async () => answer;
  await app.listen(0, "127.0.0.1"); apps.push(app);
  return { base: `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}` };
}

const ANSWER = ["제목1: 물가 오름세 한풀 꺾여", "제목2: 3.2%로 둔화", "자막1-1: 통계청 9월 발표"].join("\n");

describe("asking for a card's lines over HTTP", () => {
  const post = (base: string, body: unknown) =>
    fetch(`${base}${API_ROUTES.newsReelCardText}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("answers at the address the client builds, with the boxes and the day's count", async () => {
    const { base } = await start("test-key", ANSWER);

    const response = await post(base, { article: ARTICLE, pictures: ["통계청 브리핑실"] });

    expect(response.status).toBe(201);
    const body = await response.json() as { headline?: Record<string, string>; captions?: unknown[]; dailyCalls?: { used: number } };
    expect(body.headline?.line2).toBe("3.2%로 둔화");
    expect(body.captions).toEqual([{ line1: "통계청 9월 발표" }]);
    expect(body.dailyCalls?.used).toBe(1);
  });

  /**
   * 🔴 The key refusal has to arrive as its own code. It is the one a person can act on immediately — the key
   * goes in the settings screen — and a generic failure sends them looking at the article instead.
   */
  it("says the key is missing as a 400 with its code, having spent nothing", async () => {
    const { base } = await start(null, ANSWER);

    const response = await post(base, { article: ARTICLE, pictures: ["통계청 브리핑실"] });

    expect(response.status).toBe(400);
    expect((await response.json() as { code?: string }).code).toBe("NEWS_SUMMARY_KEY_MISSING");
  });
});
