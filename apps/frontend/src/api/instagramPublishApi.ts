import { API_ROUTES, type ForgetInstagramPostResponse, type ForgetLongEpisodeInstagramPostResponse, type PublishLongEpisodeToInstagramResponse, type PublishToInstagramResponse } from "@ai-animation-studio/shared";

export class InstagramPublishApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InstagramPublishApiError";
    this.code = code;
  }
}

/**
 * Two of these say opposite things about the world and must never be blurred together.
 *
 * `INSTAGRAM_ALREADY_PUBLISHED` means it is out there — pressing again cannot help and a duplicate post cannot
 * be taken back from whoever saw it. `INSTAGRAM_PUBLISH_FAILED` means nothing went out and no record was kept,
 * so trying again is safe. A shared "잠시 후 다시 시도" for both would tell the first case to do the one thing
 * it must not (docs/06_DECISIONS.md D-010's reasoning, applied to a public action instead of a paid one).
 */
const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  INSTAGRAM_ALREADY_PUBLISHED: "이 영상은 이미 게시되었습니다. 다시 올리면 같은 영상이 두 번 올라갑니다.",
  INSTAGRAM_VIDEO_UNAVAILABLE: "올릴 최종 영상이 없습니다. 영상을 먼저 합쳐 주세요.",
  INSTAGRAM_NOT_CONNECTED: "인스타그램 로그인이 만료되었습니다. API 설정에서 다시 로그인해 주세요.",
  INSTAGRAM_TARGET_NOT_FOUND: "고른 계정으로는 지금 올릴 수 없습니다. 계정을 다시 골라 주세요.",
  INSTAGRAM_PUBLISH_FAILED: "올리지 못했습니다. 아무것도 게시되지 않았으니 다시 시도해도 됩니다.",
  /* "지울 게 없었다" 와 "지웠다" 는 남는 상태가 같습니다. 다른 것은 다음에 올리기를 누르는 사람이 무엇을 믿고
     누르느냐고, 그래서 성공으로 삼키지 않고 이렇게 말합니다. */
  INSTAGRAM_POST_NOT_RECORDED: "이 영상에는 지울 게시 기록이 없습니다. 이미 풀려 있어 지금 올릴 수 있습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다." };

/** Never surfaces the backend's raw message or any Meta detail — only a fixed, safe message per code. */
export function toInstagramPublishDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof InstagramPublishApiError)) return UNKNOWN;
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
 * Which moment of the video Instagram should use as the cover, in milliseconds, or null for its own default.
 *
 * Omitted from the body entirely when null rather than sent as 0. The two would post the same picture — 0 is
 * Instagram's default — but "nobody chose" and "someone chose the first frame" are different facts, and only
 * one of them should be recorded as a decision.
 */
function coverField(thumbOffsetMs: number | null | undefined): { thumbOffsetMs?: number } {
  return typeof thumbOffsetMs === "number" && Number.isFinite(thumbOffsetMs) && thumbOffsetMs >= 0
    ? { thumbOffsetMs: Math.round(thumbOffsetMs) }
    : {};
}

/**
 * Publishes this project's final video. Irreversible and public — the only call in this app whose mistake cannot
 * be undone by anyone, including Instagram.
 *
 * `approved: true` is sent explicitly and is never defaulted anywhere in the chain, so no code path can reach a
 * publish without a person having said yes to a panel that named the account.
 *
 * `igUserId` travels with the request rather than being read from the stored selection server-side: that is what
 * makes "the account the confirmation named" and "the account published to" provably the same one.
 */
export async function publishToInstagram(
  projectId: string,
  caption: string,
  igUserId: string,
  thumbOffsetMs?: number | null,
): Promise<PublishToInstagramResponse> {
  let response: Response;
  try {
    response = await fetch(API_ROUTES.instagramPublish(projectId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true, caption, igUserId, ...coverField(thumbOffsetMs) }),
    });
  } catch {
    throw new InstagramPublishApiError(NETWORK.code, NETWORK.message);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    if (isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)) {
      throw new InstagramPublishApiError(body.code, body.message);
    }
    throw new InstagramPublishApiError(MALFORMED.code, MALFORMED.message);
  }

  if (!isRecord(body) || !isNonEmptyString(body.mediaId) || !isNonEmptyString(body.publishedAt) || !isRecord(body.project)) {
    throw new InstagramPublishApiError(MALFORMED.code, MALFORMED.message);
  }
  return body as unknown as PublishToInstagramResponse;
}

/**
 * Publishes one Episode's merged final video. Same irreversible, public action as the short project's, and
 * deliberately the same shape — `approved: true` sent explicitly, and the account travelling with the request
 * so the account the confirmation named is provably the one published to.
 *
 * The response carries the Episode, not just the receipt: `instagramPost` on it is what lets the screen stay
 * locked after a reload, instead of inviting a second post of something already public.
 */
export async function publishLongEpisodeToInstagram(
  projectId: string,
  episodeNumber: number,
  caption: string,
  igUserId: string,
  thumbOffsetMs?: number | null,
): Promise<PublishLongEpisodeToInstagramResponse> {
  let response: Response;
  try {
    response = await fetch(API_ROUTES.longEpisodeInstagramPublish(projectId, episodeNumber), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true, caption, igUserId, ...coverField(thumbOffsetMs) }),
    });
  } catch {
    throw new InstagramPublishApiError(NETWORK.code, NETWORK.message);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    if (isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)) {
      throw new InstagramPublishApiError(body.code, body.message);
    }
    throw new InstagramPublishApiError(MALFORMED.code, MALFORMED.message);
  }

  if (!isRecord(body) || !isNonEmptyString(body.mediaId) || !isNonEmptyString(body.publishedAt) || !isRecord(body.episode)) {
    throw new InstagramPublishApiError(MALFORMED.code, MALFORMED.message);
  }
  return body as unknown as PublishLongEpisodeToInstagramResponse;
}

/**
 * Clears this project's stored post so the video can be published again.
 *
 * Nothing on Instagram changes. That is why the argument is named `acknowledged` rather than `approved`: the
 * person is not approving an action the app will carry out, they are answering the one thing the app cannot
 * find out for itself — whether the old post was taken down. Publishing again while it is still up leaves the
 * account with two.
 *
 * Sent explicitly and never defaulted, the same discipline the publish request uses, so no code path can clear
 * a record without that answer having been given.
 */
export async function forgetInstagramPost(projectId: string): Promise<ForgetInstagramPostResponse> {
  return deletePostRecord(API_ROUTES.instagramPostRecord(projectId), "project") as Promise<ForgetInstagramPostResponse>;
}

/** The same for one Episode. The response carries the Episode so the screen unlocks without a reload. */
export async function forgetLongEpisodeInstagramPost(projectId: string, episodeNumber: number): Promise<ForgetLongEpisodeInstagramPostResponse> {
  return deletePostRecord(API_ROUTES.longEpisodeInstagramPostRecord(projectId, episodeNumber), "episode") as Promise<ForgetLongEpisodeInstagramPostResponse>;
}

/** One request shape, so the two kinds cannot answer differently about what a cleared record looks like. */
async function deletePostRecord(url: string, carried: "project" | "episode"): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledged: true }),
    });
  } catch {
    throw new InstagramPublishApiError(NETWORK.code, NETWORK.message);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    if (isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)) {
      throw new InstagramPublishApiError(body.code, body.message);
    }
    throw new InstagramPublishApiError(MALFORMED.code, MALFORMED.message);
  }

  // Checked rather than trusted: the screen unlocks on this answer, and unlocking on a body that never carried
  // the updated record would offer a second publish with nothing to show for the first.
  if (!isRecord(body) || !isRecord(body[carried])) {
    throw new InstagramPublishApiError(MALFORMED.code, MALFORMED.message);
  }
  return body;
}
