import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MediaToolError, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";
import { AudioLibraryService } from "./audio-library.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const MP3 = Buffer.from("SUQzAwAAAAAAF1RTU0UAAAAPAAAATGF2ZjYxLjcuMTAwAAAAAAAAAAAAAAA=", "base64");

function fakeRunner(options: { unavailable?: boolean; noAudioStream?: boolean; durationSeconds?: number } = {}): MediaCommandRunner {
  return async (arguments_) => {
    const args = [...arguments_];
    if (options.unavailable) throw new MediaToolError("unavailable", "not installed");
    if (args[0] === "ffprobe") {
      return {
        stdout: JSON.stringify({
          streams: options.noAudioStream ? [] : [{ codec_type: "audio" }],
          format: { duration: String(options.durationSeconds ?? 3.5) },
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
}

async function setup(runnerOptions: Parameters<typeof fakeRunner>[0] = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-library-")); roots.push(root);
  return { root, service: new AudioLibraryService(root, fakeRunner(runnerOptions)) };
}

describe("AudioLibraryService", () => {
  it("returns an empty list before anything is uploaded", async () => {
    const { service } = await setup();
    await expect(service.list()).resolves.toEqual({ tracks: [] });
  });

  it("uploads a track, probes its real duration, and lists it newest first", async () => {
    const { root, service } = await setup({ durationSeconds: 128.4 });
    const result = await service.upload(
      { buffer: MP3, originalname: "잔잔한 배경음.mp3", mimetype: "audio/mpeg" },
      { title: "잔잔한 배경음", artist: "무명", licenseKind: "self-made", attributionRequired: false },
    );

    expect(result.track).toMatchObject({
      title: "잔잔한 배경음", artist: "무명", durationSeconds: 128.4, bytes: MP3.length, source: "upload",
      licenseKind: "self-made", attributionRequired: false,
    });
    expect(result.track.trackId).toMatch(/^TRACK-[0-9A-F]{16}$/);

    const listed = await service.list();
    expect(listed.tracks).toEqual([result.track]);

    const stored = JSON.parse(await fs.readFile(path.join(root, "audio_library", "tracks.json"), "utf8")) as Array<{ file_name: string }>;
    await expect(fs.readFile(path.join(root, "audio_library", stored[0]!.file_name))).resolves.toEqual(MP3);
  });

  it("round-trips attributionText and sourceUrl when the license requires attribution", async () => {
    const { service } = await setup();
    const result = await service.upload(
      { buffer: MP3, originalname: "track.mp3" },
      { licenseKind: "cc-by", attributionRequired: true, attributionText: "Music by Jane Doe", sourceUrl: "https://example.com/track" },
    );
    expect(result.track).toMatchObject({
      licenseKind: "cc-by", attributionRequired: true,
      attributionText: "Music by Jane Doe", sourceUrl: "https://example.com/track",
    });
  });

  it("defaults the title to the original filename when none is given", async () => {
    const { service } = await setup();
    const result = await service.upload({ buffer: MP3, originalname: "track.mp3" }, { licenseKind: "self-made", attributionRequired: false });
    expect(result.track.title).toBe("track.mp3");
    expect(result.track.artist).toBeUndefined();
  });

  it("lists newest upload first", async () => {
    const { service } = await setup();
    await service.upload({ buffer: MP3, originalname: "first.mp3" }, { title: "first", licenseKind: "self-made", attributionRequired: false });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.upload({ buffer: MP3, originalname: "second.mp3" }, { title: "second", licenseKind: "self-made", attributionRequired: false });

    const listed = await service.list();
    expect(listed.tracks.map((track) => track.title)).toEqual(["second", "first"]);
  });

  it("rejects a file that is not decodable as audio, and does not leave the bytes on disk", async () => {
    const { root, service } = await setup({ noAudioStream: true });
    await expect(service.upload({ buffer: MP3, originalname: "not-audio.mp3" }, { licenseKind: "self-made", attributionRequired: false }))
      .rejects.toMatchObject({ response: { code: "AUDIO_FILE_INVALID" } });
    await expect(fs.readdir(path.join(root, "audio_library")).catch(() => [])).resolves.toEqual(
      expect.not.arrayContaining([expect.stringMatching(/\.mp3$/)]),
    );
  });

  it("rejects an unsupported file extension", async () => {
    const { service } = await setup();
    await expect(service.upload({ buffer: MP3, originalname: "track.txt" }, { licenseKind: "self-made", attributionRequired: false }))
      .rejects.toMatchObject({ response: { code: "AUDIO_FILE_INVALID" } });
  });

  it("rejects an oversized file without probing it", async () => {
    const { service } = await setup();
    const big = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(service.upload({ buffer: big, originalname: "big.mp3" }, { licenseKind: "self-made", attributionRequired: false }))
      .rejects.toMatchObject({ response: { code: "AUDIO_FILE_INVALID" } });
  });

  it("rejects an empty file", async () => {
    const { service } = await setup();
    await expect(service.upload({ buffer: Buffer.alloc(0), originalname: "empty.mp3" }, { licenseKind: "self-made", attributionRequired: false }))
      .rejects.toMatchObject({ response: { code: "AUDIO_FILE_INVALID" } });
  });

  it("rejects a path-traversal filename", async () => {
    const { service } = await setup();
    await expect(service.upload({ buffer: MP3, originalname: "../../etc/passwd.mp3" }, { licenseKind: "self-made", attributionRequired: false }))
      .rejects.toMatchObject({ response: { code: "AUDIO_FILE_INVALID" } });
  });

  it("rejects an unknown body field", async () => {
    const { service } = await setup();
    await expect(service.upload({ buffer: MP3, originalname: "track.mp3" }, { unexpected: "x", licenseKind: "self-made", attributionRequired: false }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects an upload missing licenseKind", async () => {
    const { service } = await setup();
    await expect(service.upload({ buffer: MP3, originalname: "track.mp3" }, { attributionRequired: false }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects an upload missing attributionRequired", async () => {
    const { service } = await setup();
    await expect(service.upload({ buffer: MP3, originalname: "track.mp3" }, { licenseKind: "self-made" }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects an upload with no body at all", async () => {
    const { service } = await setup();
    await expect(service.upload({ buffer: MP3, originalname: "track.mp3" }, undefined))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("requires a file", async () => {
    const { service } = await setup();
    await expect(service.upload(undefined, undefined)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("streams a track's own file by trackId, and 404s for an unknown one", async () => {
    const { service } = await setup();
    const { track } = await service.upload({ buffer: MP3, originalname: "track.mp3" }, { licenseKind: "self-made", attributionRequired: false });

    const content = await service.content(track.trackId);
    await expect(fs.readFile(content.path)).resolves.toEqual(MP3);

    await expect(service.content("TRACK-DOESNOTEXIST0")).rejects.toMatchObject({ response: { code: "AUDIO_TRACK_NOT_FOUND" } });
  });

  it("explains when FFmpeg/ffprobe itself is unavailable, rather than reporting the file as invalid", async () => {
    const { service } = await setup({ unavailable: true });
    await expect(service.upload({ buffer: MP3, originalname: "track.mp3" }, { licenseKind: "self-made", attributionRequired: false }))
      .rejects.toMatchObject({ response: { code: "AUDIO_FILE_INVALID", message: expect.stringContaining("FFmpeg") } });
  });

  it("removes a track and its underlying file, and 404s removing it again", async () => {
    const { root, service } = await setup();
    const { track } = await service.upload({ buffer: MP3, originalname: "track.mp3" }, { licenseKind: "self-made", attributionRequired: false });

    const stored = JSON.parse(await fs.readFile(path.join(root, "audio_library", "tracks.json"), "utf8")) as Array<{ file_name: string }>;
    const filePath = path.join(root, "audio_library", stored[0]!.file_name);
    await expect(fs.stat(filePath)).resolves.toBeTruthy();

    await expect(service.remove(track.trackId)).resolves.toEqual({ trackId: track.trackId });
    await expect(service.list()).resolves.toEqual({ tracks: [] });
    await expect(fs.stat(filePath)).rejects.toThrow();

    await expect(service.remove(track.trackId)).rejects.toMatchObject({ response: { code: "AUDIO_TRACK_NOT_FOUND" } });
  });
});
