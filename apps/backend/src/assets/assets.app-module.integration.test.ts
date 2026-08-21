import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
let app: INestApplication | undefined;
let root: string | undefined;
let previousRoot: string | undefined;

afterEach(async () => {
  await app?.close(); app = undefined;
  if (previousRoot === undefined) delete process.env.LEARNING_DATA_ROOT;
  else process.env.LEARNING_DATA_ROOT = previousRoot;
  previousRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

describe.sequential("real AppModule Asset HTTP smoke", () => {
  it("uses module DI for empty/list/import/detail/content and rejects encoded separators", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-app-module-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    expect(await (await fetch(`${base}/assets`)).json()).toEqual({ assets: [] });
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "검증고양이.png");
    form.append("metadata", JSON.stringify({ assetType: "character", displayName: "실제 AppModule 고양이" }));
    const createdResponse = await fetch(`${base}/assets`, { method: "POST", body: form });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { asset: { assetId: string; contentUrl: string; originalFilename: string; referenceImages: Array<{ originalFilename: string }> } };
    expect(created.asset.originalFilename).toBe("검증고양이.png");
    expect(created.asset.referenceImages.map((item) => item.originalFilename)).toEqual(["검증고양이.png", "검증고양이.png"]);

    const detail = await (await fetch(`${base}/assets/${created.asset.assetId}`)).json() as { asset: { displayName: string; originalFilename: string; referenceImages: Array<{ originalFilename: string }> }; ownership: string };
    expect(detail).toMatchObject({ asset: { displayName: "실제 AppModule 고양이", originalFilename: "검증고양이.png" }, ownership: "library_manual" });
    expect(detail.asset.referenceImages.map((item) => item.originalFilename)).toEqual(["검증고양이.png", "검증고양이.png"]);
    const content = await fetch(`${base}${created.asset.contentUrl}`);
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(png);

    const unsafe = await fetch(`${base}/assets/ASSET-BG-%2FESCAPE`);
    expect(unsafe.status).toBe(400);
    expect(await unsafe.json()).toMatchObject({ code: "UNSAFE_ASSET_ID" });
    const rawIndex = await fs.readFile(path.join(root, "asset_library", "assets.json"), "utf8");
    expect(rawIndex).toContain('"original_filename": "검증고양이.png"');
    expect(rawIndex).not.toContain("ê²");

    await app.close(); app = undefined;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const restartedBase = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const reopened = await (await fetch(`${restartedBase}/assets/${created.asset.assetId}`)).json() as typeof detail;
    expect(reopened.asset.originalFilename).toBe("검증고양이.png");
    expect(reopened.asset.referenceImages.map((item) => item.originalFilename)).toEqual(["검증고양이.png", "검증고양이.png"]);
    expect((await fs.readdir(path.join(root, "asset_library"))).filter((name) => name.endsWith(".tmp") || name === ".assets-json.lock")).toEqual([]);
  });
});
