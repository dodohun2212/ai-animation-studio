import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { LocalProjectRepository } from "./projects.repository.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
let app: INestApplication | undefined;
let root: string | undefined;
let previousRoot: string | undefined;
let previousPromptsRoot: string | undefined;
afterEach(async () => {
  await app?.close(); app = undefined;
  if (previousRoot === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = previousRoot;
  if (previousPromptsRoot === undefined) delete process.env.PROMPTS_ROOT; else process.env.PROMPTS_ROOT = previousPromptsRoot;
  previousRoot = undefined; previousPromptsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined;
});

describe.sequential("real AppModule project cast/asset-reference/continuity HTTP smoke", () => {
  it("boots the full module graph, validates a real Character Asset, and reopens the saved cast after restart", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "project-cast-app-module-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    await fetch(`${base}/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "cast_http", topic: "topic" }) });

    const assetForm = new FormData();
    assetForm.append("image", new Blob([png], { type: "image/png" }), "hero.png");
    assetForm.append("metadata", JSON.stringify({ assetType: "character", displayName: "Hero" }));
    const assetResponse = await fetch(`${base}/assets`, { method: "POST", body: assetForm });
    const asset = await assetResponse.json() as { asset: { assetId: string } };

    const missing = await fetch(`${base}/projects/cast_http/settings/cast`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cast: [{ assetId: "ASSET-CHAR-MISSING", castRole: "protagonist", storyRole: "대표 캐릭터" }] }),
    });
    expect(missing.status).toBe(400);
    expect((await missing.json() as { code: string }).code).toBe("INVALID_REQUEST");

    const saveResponse = await fetch(`${base}/projects/cast_http/settings/cast`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cast: [{ assetId: asset.asset.assetId, castRole: "protagonist", storyRole: "대표 캐릭터" }] }),
    });
    expect(saveResponse.status).toBe(200);
    expect(await saveResponse.json()).toEqual({ cast: [{ assetId: asset.asset.assetId, castRole: "protagonist", storyRole: "대표 캐릭터" }] });

    await app.close();
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const restartedBase = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const reopened = await fetch(`${restartedBase}/projects/cast_http/settings/cast`);
    expect(await reopened.json()).toEqual({ cast: [{ assetId: asset.asset.assetId, castRole: "protagonist", storyRole: "대표 캐릭터" }] });
  });

  it("reflects a saved Wizard cast selection in the Story prompt preview's character_cast_metadata placeholder", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "project-cast-app-module-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    previousPromptsRoot = process.env.PROMPTS_ROOT;
    const promptsRoot = path.join(root, "prompts", "story");
    await fs.mkdir(promptsRoot, { recursive: true });
    await fs.writeFile(path.join(promptsRoot, "story_generation.txt"), "cast=$character_cast_metadata", "utf8");
    process.env.PROMPTS_ROOT = path.join(root, "prompts");
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    await fetch(`${base}/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "cast_story", topic: "topic" }) });
    const assetForm = new FormData();
    assetForm.append("image", new Blob([png], { type: "image/png" }), "hero.png");
    assetForm.append("metadata", JSON.stringify({ assetType: "character", displayName: "Hero" }));
    const asset = await (await fetch(`${base}/assets`, { method: "POST", body: assetForm })).json() as { asset: { assetId: string } };
    await fetch(`${base}/projects/cast_story/settings/cast`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cast: [{ assetId: asset.asset.assetId, castRole: "protagonist", storyRole: "대표 캐릭터" }] }),
    });

    const preview = await (await fetch(`${base}/projects/cast_story/story/preview`, { method: "POST" })).json() as { preview: { originalPrompt: string } };
    expect(preview.preview.originalPrompt).toContain("Hero");
    expect(preview.preview.originalPrompt).toContain("대표 캐릭터");
  });

  it("validates atmosphere/scene reference Asset selections and reflects a saved selection in the Story prompt preview", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "project-cast-app-module-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    previousPromptsRoot = process.env.PROMPTS_ROOT;
    const promptsRoot = path.join(root, "prompts", "story");
    await fs.mkdir(promptsRoot, { recursive: true });
    await fs.writeFile(path.join(promptsRoot, "story_generation.txt"), "atmosphere=$atmosphere_asset_metadata\nscene_refs=$scene_reference_asset_metadata", "utf8");
    process.env.PROMPTS_ROOT = path.join(root, "prompts");
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    await fetch(`${base}/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "refs_http", topic: "topic" }) });

    const styleForm = new FormData();
    styleForm.append("image", new Blob([png], { type: "image/png" }), "style.png");
    styleForm.append("metadata", JSON.stringify({ assetType: "style", displayName: "Neon Palette" }));
    const style = await (await fetch(`${base}/assets`, { method: "POST", body: styleForm })).json() as { asset: { assetId: string } };

    const secondPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const keyForm = new FormData();
    keyForm.append("image", new Blob([secondPng], { type: "image/png" }), "key.png");
    keyForm.append("metadata", JSON.stringify({ assetType: "object", displayName: "Bronze Key" }));
    const key = await (await fetch(`${base}/assets`, { method: "POST", body: keyForm })).json() as { asset: { assetId: string } };

    const missing = await fetch(`${base}/projects/refs_http/settings/asset-references`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ atmosphereAssetIds: ["ASSET-MISSING"], sceneReferenceAssets: [] }),
    });
    expect(missing.status).toBe(400);
    expect((await missing.json() as { code: string }).code).toBe("INVALID_REQUEST");

    const overlap = await fetch(`${base}/projects/refs_http/settings/asset-references`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ atmosphereAssetIds: [style.asset.assetId], sceneReferenceAssets: [{ assetId: style.asset.assetId, purpose: "x" }] }),
    });
    expect(overlap.status).toBe(400);

    const saveResponse = await fetch(`${base}/projects/refs_http/settings/asset-references`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ atmosphereAssetIds: [style.asset.assetId], sceneReferenceAssets: [{ assetId: key.asset.assetId, purpose: "주인공이 항상 들고 다니는 열쇠" }] }),
    });
    expect(saveResponse.status).toBe(200);
    expect(await saveResponse.json()).toEqual({ atmosphereAssetIds: [style.asset.assetId], sceneReferenceAssets: [{ assetId: key.asset.assetId, purpose: "주인공이 항상 들고 다니는 열쇠" }] });

    const reopened = await fetch(`${base}/projects/refs_http/settings/asset-references`);
    expect(await reopened.json()).toEqual({ atmosphereAssetIds: [style.asset.assetId], sceneReferenceAssets: [{ assetId: key.asset.assetId, purpose: "주인공이 항상 들고 다니는 열쇠" }] });

    const preview = await (await fetch(`${base}/projects/refs_http/story/preview`, { method: "POST" })).json() as { preview: { originalPrompt: string } };
    expect(preview.preview.originalPrompt).toContain("Neon Palette");
    expect(preview.preview.originalPrompt).toContain("Bronze Key");
    expect(preview.preview.originalPrompt).toContain("주인공이 항상 들고 다니는 열쇠");
  });

  it("lists, links, reflects in the Story prompt preview, and disconnects a Scene 6 continuity source", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "project-cast-app-module-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    previousPromptsRoot = process.env.PROMPTS_ROOT;
    const promptsRoot = path.join(root, "prompts", "story");
    await fs.mkdir(promptsRoot, { recursive: true });
    await fs.writeFile(path.join(promptsRoot, "story_generation.txt"), "previous=$previous_scene_context", "utf8");
    process.env.PROMPTS_ROOT = path.join(root, "prompts");
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    await fetch(`${base}/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "cont_current", topic: "topic" }) });
    await fetch(`${base}/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "cont_prev", topic: "prev topic" }) });

    const repository = app.get(LocalProjectRepository);
    const candidate = await repository.findById("cont_prev");
    const imagesDir = path.join(root, "projects", "cont_prev", "images");
    await repository.save({
      ...candidate, workflow_state: WorkflowState.VideosReady,
      scenes: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, description: `Scene ${i + 1}` })),
      story: { title: "Previous Story", synopsis: "s", ending: "결말" },
      generated_images: Array.from({ length: 6 }, (_, i) => path.join(imagesDir, `scene${i + 1}.png`)),
    });
    await fs.mkdir(imagesDir, { recursive: true });
    await fs.writeFile(path.join(imagesDir, "scene6.png"), "fake-png-bytes");

    const options = await (await fetch(`${base}/projects/cont_current/settings/continuity-options`)).json() as { options: { projectId: string }[] };
    expect(options.options).toEqual([{ projectId: "cont_prev", projectName: "Previous Story", label: "Previous Story · Scene 6" }]);

    const linkResponse = await fetch(`${base}/projects/cont_current/settings/continuity`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "cont_prev" }),
    });
    expect(linkResponse.status).toBe(200);
    expect(await linkResponse.json()).toEqual({ link: { projectId: "cont_prev", projectName: "Previous Story", label: "Previous Story · Scene 6" } });

    const linkedPreview = await (await fetch(`${base}/projects/cont_current/story/preview`, { method: "POST" })).json() as { preview: { originalPrompt: string } };
    expect(linkedPreview.preview.originalPrompt).toContain("Previous Story");
    expect(linkedPreview.preview.originalPrompt).toContain("Scene 6");

    const disconnectResponse = await fetch(`${base}/projects/cont_current/settings/continuity`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: null }),
    });
    expect(await disconnectResponse.json()).toEqual({ link: null });
    const disconnectedPreview = await (await fetch(`${base}/projects/cont_current/story/preview`, { method: "POST" })).json() as { preview: { originalPrompt: string } };
    expect(disconnectedPreview.preview.originalPrompt).toBe("previous=");
  });
});
