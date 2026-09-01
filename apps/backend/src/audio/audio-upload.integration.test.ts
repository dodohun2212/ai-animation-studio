import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";
import { API_ROUTES, AUDIO_UPLOAD_FILE_FIELD } from "@ai-animation-studio/shared";

import { MediaToolError, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";
import { AudioLibraryController } from "./audio-library.controller.js";
import { AudioLibraryService } from "./audio-library.service.js";

/**
 * The BGM upload over real HTTP, as a browser sends it.
 *
 * Everything on both sides of this request already had a test and all of them were green while the feature had
 * never once worked. The frontend's test asserted the FormData it built; the service's test called `upload()`
 * with a file object it constructed itself. Between them sat multipart — which names the file part and turns
 * every other field into a string — and nothing crossed it. Two separate defects were living in that gap
 * (docs/06_DECISIONS.md D-031: "받는다" and "쓴다" each had a test, the middle had none).
 *
 * So this test sends the bytes. It builds the same FormData `uploadAudioTrack` builds and posts it to the real
 * route on a real Nest instance, and it is the only test in the repo that can see either defect.
 */
const MP3 = Buffer.from("SUQzAwAAAAAAF1RTU0UAAAAPAAAATGF2ZjYxLjcuMTAwAAAAAAAAAAAAAAA=", "base64");

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

async function start() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-upload-http-")); roots.push(root);
  class TestModule {}
  Module({ controllers: [AudioLibraryController], providers: [{ provide: AudioLibraryService, useValue: new AudioLibraryService(root, fakeProbe) }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, "127.0.0.1"); apps.push(app);
  return { root, base: `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}` };
}

/** Exactly what apps/frontend's `uploadAudioTrack` puts on the wire — same part name, same string-valued fields. */
function browserForm(fileFieldName: string = AUDIO_UPLOAD_FILE_FIELD): FormData {
  const form = new FormData();
  form.append(fileFieldName, new Blob([MP3], { type: "audio/mpeg" }), "잔잔한 배경음.mp3");
  form.append("title", "잔잔한 배경음");
  form.append("artist", "무명");
  form.append("licenseKind", "self-made");
  form.append("attributionRequired", "false");
  return form;
}

describe("BGM upload over HTTP", () => {
  it("accepts the multipart request a browser actually sends", async () => {
    const { base } = await start();

    const response = await fetch(`${base}${API_ROUTES.audioLibraryUpload}`, { method: "POST", body: browserForm() });

    expect(response.status).toBe(201);
    const body = await response.json() as { track: { title: string; durationSeconds: number; licenseKind: string; attributionRequired: boolean } };
    expect(body.track).toMatchObject({ title: "잔잔한 배경음", durationSeconds: 128.4, licenseKind: "self-made", attributionRequired: false });
  });

  // The checkbox arrives as the text "true", not as JSON's true, and the difference is the whole feature.
  it("carries a checked attribution box through as a boolean", async () => {
    const { base } = await start();
    const form = browserForm();
    form.set("attributionRequired", "true");
    form.append("attributionText", "Music by 무명");

    const response = await fetch(`${base}${API_ROUTES.audioLibraryUpload}`, { method: "POST", body: form });

    expect(response.status).toBe(201);
    const body = await response.json() as { track: { attributionRequired: boolean; attributionText?: string } };
    expect(body.track.attributionRequired).toBe(true);
    expect(body.track.attributionText).toBe("Music by 무명");
  });

  // Multer hands the filename over as Latin-1 bytes, so a Korean name arrives looking like C1 control
  // characters. Every MP3 named in Korean was refused for it — and this is the app's own language, so it was
  // not an edge case but the common upload. Asserted through the title, which falls back to the filename.
  it("keeps a Korean filename intact across the wire", async () => {
    const { base } = await start();
    const form = browserForm();
    form.delete("title");

    const response = await fetch(`${base}${API_ROUTES.audioLibraryUpload}`, { method: "POST", body: form });

    expect(response.status).toBe(201);
    expect((await response.json() as { track: { title: string } }).track.title).toBe("잔잔한 배경음.mp3");
  });

  // Anything that is not one of those two words is a caller that does not know the contract, and guessing
  // "false" for it would silently record a track as free to use.
  it("refuses an attribution flag that is neither true nor false", async () => {
    const { base } = await start();
    const form = browserForm();
    form.set("attributionRequired", "maybe");

    const response = await fetch(`${base}${API_ROUTES.audioLibraryUpload}`, { method: "POST", body: form });

    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe("INVALID_REQUEST");
  });

  // The original defect, kept as a test rather than as a memory: under any other name the file does not reach
  // the route at all. The refusal is about the file (`AUDIO_FILE_INVALID` — multer rejects the unexpected part
  // before the handler runs), which is the code the screen now has a sentence for; what must never happen again
  // is this succeeding, or arriving as something the person is told to retry.
  it("never sees a file part sent under a different name", async () => {
    const { base } = await start();

    const response = await fetch(`${base}${API_ROUTES.audioLibraryUpload}`, { method: "POST", body: browserForm("file") });

    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe("AUDIO_FILE_INVALID");
  });
});
