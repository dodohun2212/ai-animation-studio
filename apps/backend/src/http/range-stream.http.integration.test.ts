import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";
import { API_ROUTES } from "@ai-animation-studio/shared";

import { AssetsController } from "../assets/assets.controller.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { AssetsService } from "../assets/assets.service.js";
import { AudioLibraryController } from "../audio/audio-library.controller.js";
import { AudioLibraryService } from "../audio/audio-library.service.js";
import { MediaToolError, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";

/**
 * Seeking, as a browser actually does it.
 *
 * A player asks for the middle of a file with a `Range` header and is only allowed to ask at all because the
 * server said `Accept-Ranges`. Neither existed anywhere in this app, so every file played from the start and
 * could never be moved through — including the final Reel on the publish screen, where the "use this frame as
 * the cover" button is built around the person choosing a moment first (Cowork Round 430; 캡틴D asked for it on
 * that screen in Round 431).
 *
 * The assertions are on the wire and not on the helper: a test that calls `streamStoredFile` directly would
 * have passed all along on a route that never called it. Two different libraries are exercised because the
 * defect was twelve copies of one block, and one fixed copy would look exactly like this from inside a unit
 * test.
 */
const MP3 = Buffer.from("SUQzAwAAAAAAF1RTU0UAAAAPAAAATGF2ZjYxLjcuMTAwAAAAAAAAAAAAAAA=", "base64");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");

const roots: string[] = [];
const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const fakeProbe: MediaCommandRunner = async (arguments_) => {
  if ([...arguments_][0] !== "ffprobe") throw new MediaToolError("failed", "unexpected command");
  return { stdout: JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "128.4" } }), stderr: "" };
};

async function startApp(controllers: unknown[], providers: unknown[]) {
  class TestModule {}
  Module({ controllers: controllers as never[], providers: providers as never[] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, "127.0.0.1"); apps.push(app);
  return `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
}

/** One uploaded BGM track, served by the real audio route. */
async function audioTrack() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "range-audio-")); roots.push(root);
  const audio = new AudioLibraryService(root, fakeProbe);
  const uploaded = await audio.upload({ buffer: MP3, originalname: "night.mp3", mimetype: "audio/mpeg" }, { licenseKind: "cc0", attributionRequired: false });
  const base = await startApp([AudioLibraryController], [{ provide: AudioLibraryService, useValue: audio }]);
  return { url: `${base}${API_ROUTES.audioLibraryContent(uploaded.track.trackId)}`, size: MP3.length };
}

/** One imported Library picture, served by the real asset route. */
async function assetPicture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "range-asset-")); roots.push(root);
  const service = new AssetsService(new LocalAssetsRepository(root));
  const created = await service.create({ buffer: PNG, originalname: "city.png", mimetype: "image/png" }, JSON.stringify({ assetType: "background", displayName: "Night City" }));
  const base = await startApp([AssetsController], [{ provide: AssetsService, useValue: service }]);
  return { url: `${base}${created.asset.contentUrl}`, size: PNG.length };
}

describe("stored media over HTTP", () => {
  it("tells a player it may seek, on the ordinary full response", async () => {
    for (const open of [audioTrack, assetPicture]) {
      const { url, size } = await open();

      const response = await fetch(url);

      expect(response.status).toBe(200);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("content-length")).toBe(String(size));
      expect(response.headers.get("content-range")).toBeNull();
      expect((await response.arrayBuffer()).byteLength).toBe(size);
    }
  });

  it("answers a range with 206, that range's bytes, and where they sit in the file", async () => {
    const { url, size } = await audioTrack();

    const response = await fetch(url, { headers: { range: "bytes=10-19" } });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 10-19/${size}`);
    expect(response.headers.get("content-length")).toBe("10");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(MP3.subarray(10, 20));
  });

  // What a player actually sends when someone drags the bar: everything from here on.
  it("answers an open range with the rest of the file", async () => {
    const { url, size } = await audioTrack();

    const response = await fetch(url, { headers: { range: "bytes=20-" } });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 20-${size - 1}/${size}`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(MP3.subarray(20));
  });

  it("refuses a range past the end with 416 and the real size, instead of inventing bytes", async () => {
    const { url, size } = await audioTrack();

    const response = await fetch(url, { headers: { range: `bytes=${size + 10}-` } });

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${size}`);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("still answers 200 for a range header it does not serve", async () => {
    const { url, size } = await assetPicture();

    const response = await fetch(url, { headers: { range: "bytes=0-1,4-5" } });

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(size);
  });
});
