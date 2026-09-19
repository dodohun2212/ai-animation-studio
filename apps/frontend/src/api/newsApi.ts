import {
  API_ROUTES,
  type NewsFetchArticleRequest,
  type NewsFetchArticleResponse,
  type NewsReelSetupResponse,
  isNewsFetchArticleResponse,
  isNewsReelSetupResponse,
} from "@ai-animation-studio/shared";

import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

export class NewsApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NewsApiError";
    this.code = code;
  }
}

/**
 * One read, shared by both routes.
 *
 * A `fetch` that rejects means the backend never answered — down, restarting, or a dev proxy replying instead —
 * and that is a different sentence from a request that fell over inside a running server (see httpError.ts).
 */
async function read<T>(url: string, init: RequestInit | undefined, guard: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new NewsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const carried = (body as { code?: unknown } | null)?.code;
    const code = typeof carried === "string" ? carried : INTERNAL_ERROR.code;
    if (isServerUnavailable(response.status, code)) {
      throw new NewsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    const message = typeof (body as { message?: unknown } | null)?.message === "string"
      ? (body as { message: string }).message
      : INTERNAL_ERROR.message;
    throw new NewsApiError(code, message);
  }
  if (!guard(body)) throw new NewsApiError(INTERNAL_ERROR.code, INTERNAL_ERROR.message);
  return body;
}

/**
 * What the screen reads when it opens.
 *
 * 🔴 **This does not throw when the ledger is unreadable, and it must not.** The server answers `dailyCalls:
 * null` in that case — a statement, not a gap — and turning it into an exception here would lose the publisher
 * list along with it, which has nothing to do with the ledger. The screen draws `null` as *「오늘 쓸 수 있는지
 * 확인할 수 없습니다」* and keeps the button closed; what it must never do is read a missing count as room to
 * spend (see NewsDailyCallCount).
 */
export function getNewsReelSetup(): Promise<NewsReelSetupResponse> {
  return read(API_ROUTES.newsReelSetup, undefined, isNewsReelSetupResponse);
}

/**
 * Ask the server to fetch one article.
 *
 * 🔴 **This is called for any address the person typed, including one whose host is not on the list.** The
 * publisher list travels so the screen can *say* it, never so the screen can decide with it: the host that
 * matters is the one a redirect finally lands on, and only the server sees that (CLI Round 929 §2). Filtering
 * here would look like kindness and would be a second, worse copy of the check — one that is wrong about
 * exactly the addresses the real check exists for. A pair holds this open.
 *
 * None of the four outcomes is an exception. A refusal, an unreachable host and a page whose body we could not
 * find are all answers the screen draws differently; throwing would flatten them into one red box.
 */
export function fetchNewsArticle(url: string): Promise<NewsFetchArticleResponse> {
  const request: NewsFetchArticleRequest = { url };
  return read(API_ROUTES.newsArticle, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, isNewsFetchArticleResponse);
}
