import {
  API_ROUTES,
  type GeneratedEpisodeImageSummary,
  type GeneratedImageSummary,
  type GetGeneratedImagesResponse,
  type SceneNumber,
} from "@ai-animation-studio/shared";

export class GeneratedImagesApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GeneratedImagesApiError";
    this.code = code;
  }
}

const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or any filesystem path — the same rule the other libraries follow. */
export function toGeneratedImagesDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof GeneratedImagesApiError)) return UNKNOWN;
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

function isSceneNumber(value: unknown): value is SceneNumber {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isGeneratedImage(value: unknown): value is GeneratedImageSummary {
  return isRecord(value)
    && isNonEmptyString(value.projectId)
    && typeof value.projectTitle === "string"
    && isSceneNumber(value.sceneNumber)
    && isNonEmptyString(value.updatedAt)
    && typeof value.bytes === "number" && Number.isFinite(value.bytes) && value.bytes >= 0;
}

function isGeneratedEpisodeImage(value: unknown): value is GeneratedEpisodeImageSummary {
  return isGeneratedImage(value)
    && isRecord(value)
    && typeof value.episodeNumber === "number" && Number.isInteger(value.episodeNumber) && value.episodeNumber >= 1
    && typeof value.episodeTitle === "string";
}

/**
 * Every scene image this app has generated, newest first. Read-only, and never charges anything.
 *
 * Exists because the pictures were only ever reachable through the project that made them: someone looking for
 * "that drawing from a while back" had to remember which project it was in first. Placeholders from
 * no-provider runs are left out by the server — a 1×1 white dot is not something anyone is looking for.
 */
export async function getGeneratedImages(): Promise<GetGeneratedImagesResponse> {
  let response: Response;
  try {
    response = await fetch(API_ROUTES.generatedImages);
  } catch {
    throw new GeneratedImagesApiError(NETWORK.code, NETWORK.message);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const shape = isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)
      ? { code: body.code, message: body.message }
      : MALFORMED;
    throw new GeneratedImagesApiError(shape.code, shape.message);
  }
  if (!isRecord(body) || !Array.isArray(body.projects) || !body.projects.every(isGeneratedImage)) {
    throw new GeneratedImagesApiError(MALFORMED.code, MALFORMED.message);
  }
  // Episode rows are checked but do not invalidate the answer, the same way the video library treats them: a
  // malformed Episode must not cost the person the short-project rows they can still use.
  const episodes = Array.isArray(body.episodes) ? body.episodes.filter(isGeneratedEpisodeImage) : [];
  return { projects: body.projects, episodes };
}

/**
 * Where one listed image's bytes live.
 *
 * Deliberately the same addresses the review screens already use — a second URL for the same bytes is a second
 * opinion about where they are. `updatedAt` is the file's own mtime, so regenerating a scene changes the URL
 * and the browser fetches the new picture instead of replaying the cached old one.
 */
export function generatedImageContentUrl(image: GeneratedImageSummary): string {
  return `${API_ROUTES.imageContent(image.projectId, image.sceneNumber)}?v=${encodeURIComponent(image.updatedAt)}`;
}

export function generatedEpisodeImageContentUrl(image: GeneratedEpisodeImageSummary): string {
  return `${API_ROUTES.longEpisodeImageContent(image.projectId, image.episodeNumber, image.sceneNumber)}?v=${encodeURIComponent(image.updatedAt)}`;
}
