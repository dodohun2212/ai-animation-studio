import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";
import { API_ROUTES } from "@ai-animation-studio/shared";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { PhotoCardController } from "./photo-card.controller.js";
import { PhotoCardService } from "./photo-card.service.js";
import { LocalProjectRepository } from "./projects.repository.js";

/**
 * Pressing "make the card" twice, over real HTTP.
 *
 * The second press answered *"사진 카드를 저장하지 못했습니다"* about a card that had been made perfectly a
 * moment before — the repository's `PROJECT_ALREADY_EXISTS` was caught and replaced by a storage error, so the
 * one screen that has the right sentence for a taken name could never receive the code for it (Cowork Round
 * 432). The service's own tests could not see it: they read the exception this service throws, which was the
 * wrapped one either way.
 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");

const roots: string[] = [];
const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function start() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "photo-card-http-")); roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const assets = new LocalAssetsRepository(root);
  const asset = await assets.create({ buffer: PNG, originalname: "quote.png", mimetype: "image/png" }, { assetType: "general_reference", displayName: "배경" });
  const service = new PhotoCardService(new LocalProjectRepository(projectsRoot), assets, projectsRoot);
  class TestModule {}
  Module({ controllers: [PhotoCardController], providers: [{ provide: PhotoCardService, useValue: service }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, "127.0.0.1"); apps.push(app);
  return { root, assetId: asset.asset_id, base: `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}` };
}

describe("photo card creation over HTTP", () => {
  it("names a taken project name as taken, instead of calling the finished card a failed write", async () => {
    const { base, assetId, root } = await start();
    const body = JSON.stringify({ projectId: "card_one", assetId, quote: "불광불급", clipDurationSeconds: 5, aspectRatio: "9:16" });
    const post = () => fetch(`${base}${API_ROUTES.photoCards}`, { method: "POST", headers: { "content-type": "application/json" }, body });

    expect((await post()).status).toBe(201);
    const second = await post();

    expect(second.status).toBe(409);
    const failure = await second.json() as { code: string; message: string };
    expect(failure.code).toBe("PROJECT_ALREADY_EXISTS");
    expect(failure.message).not.toContain(root);
  });

  // The first card must still be there afterwards: a refused second press is not a reason to disturb it.
  it("leaves the card the first press made exactly as it was", async () => {
    const { base, assetId, root } = await start();
    const body = JSON.stringify({ projectId: "card_one", assetId, quote: "불광불급", clipDurationSeconds: 5, aspectRatio: "9:16" });
    const post = () => fetch(`${base}${API_ROUTES.photoCards}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    await post();
    const picture = path.join(root, "projects", "card_one", "images", "scene1.png");
    const before = await fs.readFile(picture);

    await post();

    expect(await fs.readFile(picture)).toEqual(before);
    const stored = JSON.parse(await fs.readFile(path.join(root, "projects", "card_one", "project.json"), "utf8")) as { generated_images: string[] };
    expect(stored.generated_images).toHaveLength(1);
  });
});
