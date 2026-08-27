import {
  API_ROUTES,
  type AudioLibraryTrack,
  type DeleteAudioTrackResponse,
  type GetAudioLibraryResponse,
  type UploadAudioTrackRequest,
  type UploadAudioTrackResponse,
} from "@ai-animation-studio/shared";

export class AudioLibraryApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AudioLibraryApiError";
    this.code = code;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  AUDIO_TRACK_NOT_FOUND: "이 음원을 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요.",
  AUDIO_FORMAT_UNSUPPORTED: "지원하지 않는 오디오 형식입니다. MP3, WAV, M4A, OGG 파일을 올려 주세요.",
  AUDIO_FILE_TOO_LARGE: "파일이 너무 큽니다. 50MB 이하로 올려 주세요.",
  AUDIO_STORAGE_ERROR: "음원을 저장하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  AUDIO_TRACK_IN_USE: "이 음원을 쓰고 있는 프로젝트가 있어 지울 수 없습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or any filesystem path — only a fixed, safe message per code. */
export function toAudioLibraryDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof AudioLibraryApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  return UNKNOWN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A duration drives the "does this cover the whole video" judgement, so a non-finite or negative one is rejected
 * rather than rendered: "-1:00" next to a real length would make the reader distrust both.
 */
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const LICENSE_KINDS = ["cc0", "cc-by", "purchased", "self-made", "other"] as const;

function isLicenseKind(value: unknown): value is AudioLibraryTrack["licenseKind"] {
  return typeof value === "string" && (LICENSE_KINDS as readonly string[]).includes(value);
}

function isTrack(value: unknown): value is AudioLibraryTrack {
  return (
    isRecord(value)
    && isNonEmptyString(value.trackId)
    && typeof value.title === "string"
    && (value.artist === undefined || typeof value.artist === "string")
    && isNonNegativeNumber(value.durationSeconds)
    && isNonNegativeNumber(value.bytes)
    && value.source === "upload"
    && isLicenseKind(value.licenseKind)
    && typeof value.attributionRequired === "boolean"
    && (value.attributionText === undefined || typeof value.attributionText === "string")
    && (value.sourceUrl === undefined || typeof value.sourceUrl === "string")
    && isNonEmptyString(value.addedAt)
  );
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toApiErrorShape(body: unknown): { code: string; message: string } {
  if (isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)) {
    return { code: body.code, message: body.message };
  }
  return MALFORMED;
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new AudioLibraryApiError(NETWORK.code, NETWORK.message);
  }
  const body = await readJsonBody(response);
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    throw new AudioLibraryApiError(apiError.code, apiError.message);
  }
  return body;
}

/** Read-only listing of every uploaded BGM track. Never charges anything — these are the user's own files. */
export async function getAudioLibrary(): Promise<GetAudioLibraryResponse> {
  const body = await request(API_ROUTES.audioLibrary);
  if (!isRecord(body) || !Array.isArray(body.tracks) || !body.tracks.every(isTrack)) {
    throw new AudioLibraryApiError(MALFORMED.code, MALFORMED.message);
  }
  return { tracks: body.tracks };
}

/**
 * Uploads one audio file. Multipart, so no `content-type` header is set by hand — the browser writes the
 * boundary itself and overriding it silently breaks the parse on the other end.
 */
export async function uploadAudioTrack(file: File, fields: UploadAudioTrackRequest): Promise<UploadAudioTrackResponse> {
  const form = new FormData();
  form.append("file", file);
  if (fields.title?.trim()) form.append("title", fields.title.trim());
  if (fields.artist?.trim()) form.append("artist", fields.artist.trim());
  // Required by the server: where the track came from is only knowable while the person still has the file in
  // hand, so it is collected now rather than left to be reconstructed later (docs/06_DECISIONS.md D-002).
  form.append("licenseKind", fields.licenseKind);
  form.append("attributionRequired", String(fields.attributionRequired));
  if (fields.attributionText?.trim()) form.append("attributionText", fields.attributionText.trim());
  if (fields.sourceUrl?.trim()) form.append("sourceUrl", fields.sourceUrl.trim());

  const body = await request(API_ROUTES.audioLibraryUpload, { method: "POST", body: form });
  if (!isRecord(body) || !isTrack(body.track)) {
    throw new AudioLibraryApiError(MALFORMED.code, MALFORMED.message);
  }
  return { track: body.track };
}

/** Removes one uploaded track permanently. Safe to offer here — unlike a generated video, the source file is still on the uploader's own machine, so a mistaken upload costs nothing to redo. */
export async function deleteAudioTrack(trackId: string): Promise<DeleteAudioTrackResponse> {
  const body = await request(API_ROUTES.audioLibraryTrack(trackId), { method: "DELETE" });
  if (!isRecord(body) || !isNonEmptyString(body.trackId)) {
    throw new AudioLibraryApiError(MALFORMED.code, MALFORMED.message);
  }
  return { trackId: body.trackId };
}

/** Playback URL for one track. The audio element does the fetching, so this never throws. */
export function audioTrackContentUrl(trackId: string): string {
  return API_ROUTES.audioLibraryContent(trackId);
}
