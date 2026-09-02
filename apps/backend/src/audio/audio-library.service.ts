import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { AUDIO_LICENSE_KINDS, type AudioLibraryTrack, type AudioLicenseKind, type GetAudioLibraryResponse, type UploadAudioTrackResponse } from "@ai-animation-studio/shared";

import { safeUploadFilename } from "../assets/upload-filename.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { MediaToolError, runMediaCommand, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";
// Generic despite the name — see withProjectLock's own doc comment; it just needs any directory plus a key, and
// reusing the already-tested cross-process lock here avoids writing a second lock implementation for the same
// "read-modify-write a shared JSON index" problem asset_library's own index already has to solve too.
import { withProjectLock } from "../videos/project-lock.js";
import {
  audioContentUnavailable,
  audioStorageError,
  audioTrackNotFound,
  invalidAudioFile,
  invalidAudioRequest,
} from "./audio-api.error.js";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg"]);

/** The contract's own list — a second copy here is the shape that made a written value unreadable in the project schema (Cowork Round 436). */
const LICENSE_KINDS = AUDIO_LICENSE_KINDS;
type LicenseKind = AudioLicenseKind;

interface StoredTrack {
  track_id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  bytes: number;
  source: "upload";
  license_kind: LicenseKind;
  attribution_required: boolean;
  attribution_text: string;
  source_url: string;
  added_at: string;
  file_name: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function isStoredTrack(value: unknown): value is StoredTrack {
  return isObject(value)
    && typeof value.track_id === "string" && typeof value.title === "string" && typeof value.artist === "string"
    && typeof value.duration_seconds === "number" && Number.isFinite(value.duration_seconds) && value.duration_seconds > 0
    && typeof value.bytes === "number" && Number.isInteger(value.bytes) && value.bytes > 0
    && value.source === "upload"
    && LICENSE_KINDS.includes(value.license_kind as LicenseKind) && typeof value.attribution_required === "boolean"
    && typeof value.attribution_text === "string" && typeof value.source_url === "string"
    && typeof value.added_at === "string" && typeof value.file_name === "string";
}

function toApiTrack(stored: StoredTrack): AudioLibraryTrack {
  return {
    trackId: stored.track_id,
    title: stored.title,
    ...(stored.artist ? { artist: stored.artist } : {}),
    durationSeconds: stored.duration_seconds,
    bytes: stored.bytes,
    source: stored.source,
    licenseKind: stored.license_kind,
    attributionRequired: stored.attribution_required,
    ...(stored.attribution_text ? { attributionText: stored.attribution_text } : {}),
    ...(stored.source_url ? { sourceUrl: stored.source_url } : {}),
    addedAt: stored.added_at,
  };
}

/**
 * The one boolean this upload takes, read from a multipart form.
 *
 * A multipart body has no types — every field arrives as text — so `attributionRequired` reached here as the
 * string "false" and was refused for not being a boolean. Every real upload from the app carried it, so every
 * real upload was rejected with "요청 형식이 올바르지 않습니다.", and no test could see it: this service's own
 * tests hand `upload()` a JavaScript object with a real boolean in it, which no HTTP request can produce.
 *
 * Strictly the two words. `Boolean("false")` is `true` and `!!value` is worse: a lenient parse here would store
 * a track that must be credited as one that need not be, which is the person's licence problem months later
 * (see audio-upload.integration.test.ts, and D-031 for why the check now happens over the wire).
 */
function multipartBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * The uploader's own filename, repaired and checked.
 *
 * This used to be a private copy of image-validation.ts's check with the mojibake repair left out, under a
 * comment saying audio had no need for one. It did: Multer hands over a Korean filename as Latin-1 bytes, whose
 * C1 range is exactly what the control-character check rejects, so every MP3 named in Korean was refused as an
 * invalid filename. One implementation now, in upload-filename.ts.
 */
function safeOriginalName(name: string): string {
  const normalized = safeUploadFilename(name);
  if (normalized === undefined) throw invalidAudioFile("Audio filename is invalid.");
  return normalized;
}

async function probeAudio(runner: MediaCommandRunner, file: string): Promise<{ durationSeconds: number }> {
  let result: { stdout: string; stderr: string };
  try {
    result = await runner(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  } catch (error) {
    if (error instanceof MediaToolError && error.kind === "unavailable") throw error;
    throw new MediaToolError("invalid", "Audio file is invalid.");
  }
  try {
    const data = JSON.parse(result.stdout) as { streams?: Array<{ codec_type?: unknown }>; format?: { duration?: unknown } };
    const hasAudio = Array.isArray(data.streams) && data.streams.some((stream) => stream.codec_type === "audio");
    const duration = Number(data.format?.duration);
    if (!hasAudio || !Number.isFinite(duration) || duration <= 0) throw new Error("invalid");
    return { durationSeconds: duration };
  } catch {
    throw new MediaToolError("invalid", "Audio file is invalid.");
  }
}

/**
 * A project-independent library of user-supplied background music, distinct from both the Asset Library (input
 * material for image generation) and the Video Library (a results archive) — see VideoLibraryProjectSummary's
 * doc comment for that distinction. "upload" is the only source today; external search/import against a
 * provider that actually has a music API was investigated and abandoned (docs/06_DECISIONS.md D-001).
 */
@Injectable()
export class AudioLibraryService {
  constructor(
    private readonly learningDataRoot: string,
    private readonly runner: MediaCommandRunner = runMediaCommand,
  ) {}

  private get libraryRoot(): string {
    return path.join(this.learningDataRoot, "audio_library");
  }

  private get indexPath(): string {
    return path.join(this.libraryRoot, "tracks.json");
  }

  private trackFile(storedFileName: string): string {
    return path.join(this.libraryRoot, storedFileName);
  }

  private async load(): Promise<StoredTrack[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.indexPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw audioStorageError();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw audioStorageError();
    }
    if (!Array.isArray(parsed) || !parsed.every(isStoredTrack)) throw audioStorageError();
    return parsed;
  }

  private async save(tracks: StoredTrack[]): Promise<void> {
    await fs.mkdir(this.libraryRoot, { recursive: true });
    try {
      await atomicWriteUtf8File(this.indexPath, JSON.stringify(tracks, null, 2));
    } catch {
      throw audioStorageError();
    }
  }

  async list(): Promise<GetAudioLibraryResponse> {
    const tracks = await this.load();
    return { tracks: tracks.map(toApiTrack).sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)) };
  }

  async upload(file: { buffer: Buffer; originalname: string; mimetype?: string } | undefined, body: unknown): Promise<UploadAudioTrackResponse> {
    if (!file) throw invalidAudioRequest("An audio file is required.");
    const allowedKeys = new Set(["title", "artist", "licenseKind", "attributionRequired", "attributionText", "sourceUrl"]);
    const attributionRequired = multipartBoolean(isObject(body) ? body.attributionRequired : undefined);
    if (!isObject(body) || Object.keys(body).some((key) => !allowedKeys.has(key))
      || (body.title !== undefined && typeof body.title !== "string") || (body.artist !== undefined && typeof body.artist !== "string")
      || !LICENSE_KINDS.includes(body.licenseKind as LicenseKind) || attributionRequired === undefined
      || (body.attributionText !== undefined && typeof body.attributionText !== "string")
      || (body.sourceUrl !== undefined && typeof body.sourceUrl !== "string")) {
      throw invalidAudioRequest("Upload request is invalid — licenseKind and attributionRequired are required.");
    }
    if (file.buffer.length === 0 || file.buffer.length > MAX_BYTES) throw invalidAudioFile(file.buffer.length > MAX_BYTES ? "Audio file exceeds 50 MB." : undefined);
    const originalName = safeOriginalName(file.originalname);
    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw invalidAudioFile("Audio file type is unsupported — use MP3, WAV, M4A, or OGG.");

    const trackId = `TRACK-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const storedFileName = `${trackId}${extension}`;
    const destination = this.trackFile(storedFileName);
    await fs.mkdir(this.libraryRoot, { recursive: true });
    try {
      await fs.writeFile(destination, file.buffer);
    } catch {
      throw audioStorageError();
    }
    let durationSeconds: number;
    try {
      ({ durationSeconds } = await probeAudio(this.runner, destination));
    } catch (error) {
      await fs.unlink(destination).catch(() => undefined);
      if (error instanceof MediaToolError && error.kind === "unavailable") throw invalidAudioFile("Could not verify the audio file — FFmpeg/ffprobe is not available on this computer.");
      throw invalidAudioFile("Audio file cannot be decoded or its structure is invalid.");
    }

    const stored: StoredTrack = {
      track_id: trackId,
      title: (typeof body.title === "string" ? body.title.trim() : "") || originalName,
      artist: typeof body.artist === "string" ? body.artist.trim() : "",
      duration_seconds: durationSeconds,
      bytes: file.buffer.length,
      source: "upload",
      license_kind: body.licenseKind as LicenseKind,
      attribution_required: attributionRequired,
      attribution_text: typeof body.attributionText === "string" ? body.attributionText.trim() : "",
      source_url: typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "",
      added_at: new Date().toISOString(),
      file_name: storedFileName,
    };

    await withProjectLock(this.libraryRoot, "tracks-json", async () => {
      const tracks = await this.load();
      tracks.push(stored);
      await this.save(tracks);
    }).catch(async (error) => {
      await fs.unlink(destination).catch(() => undefined);
      throw error;
    });

    return { track: toApiTrack(stored) };
  }

  /** Full track metadata (title/license/attribution) — distinct from content(), which only resolves the playable file path. */
  async get(trackId: string): Promise<AudioLibraryTrack> {
    const tracks = await this.load();
    const track = tracks.find((item) => item.track_id === trackId);
    if (!track) throw audioTrackNotFound();
    return toApiTrack(track);
  }

  async content(trackId: string): Promise<{ path: string }> {
    const tracks = await this.load();
    const track = tracks.find((item) => item.track_id === trackId);
    if (!track) throw audioTrackNotFound();
    const file = this.trackFile(track.file_name);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size <= 0) throw new Error("invalid");
    } catch {
      throw audioContentUnavailable();
    }
    return { path: file };
  }

  /**
   * Unlike the Video Library's deliberate no-delete policy (those are paid AI-generation results — see
   * VideoLibraryProjectSummary's doc comment), BGM tracks are the user's own uploaded files, replaceable at zero
   * cost by re-uploading. That matches the Asset Library's existing removal precedent, so delete (not a hide
   * state) is the right model here (docs/06_DECISIONS.md D-004).
   */
  async remove(trackId: string): Promise<{ trackId: string }> {
    let removedFileName: string | undefined;
    await withProjectLock(this.libraryRoot, "tracks-json", async () => {
      const tracks = await this.load();
      const track = tracks.find((item) => item.track_id === trackId);
      if (!track) throw audioTrackNotFound();
      removedFileName = track.file_name;
      await this.save(tracks.filter((item) => item.track_id !== trackId));
    });
    if (removedFileName) await fs.unlink(this.trackFile(removedFileName)).catch(() => undefined);
    return { trackId };
  }
}
