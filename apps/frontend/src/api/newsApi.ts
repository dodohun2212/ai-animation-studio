import {
  API_ROUTES,
  type NewsFetchArticleRequest,
  type NewsFetchArticleResponse,
  type NewsReelSetupResponse,
  type CreateNewsSummaryRequest,
  type CreateNewsSummaryResponse,
  type NewsArticleInput,
  isCreateNewsSummaryResponse,
  isNewsFetchArticleResponse,
  isNewsReelSetupResponse,
} from "@ai-animation-studio/shared";

import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

/**
 * What a person reads for each refusal the summary route can send.
 *
 * 🔴 Five sentences rather than one, because **each leaves a different next action** — and two of them are
 * opposites that must never be collapsed: "today's allowance is gone" means wait, and "the ledger cannot be
 * read" means open that file, pressing again does the same thing. Giving the second one the first one's advice
 * is how somebody sits waiting for a midnight that will not fix anything.
 *
 * 🟠 Kept here as well as on the server, not instead of it. The backend's sentences are what a person sees
 * today; this table is what `error-code-reach` asks for — that a screen can say *something* about every code
 * the backend can throw — and it is also what shows if the two ever drift, because a code answered by both is
 * a code somebody is looking at.
 */
const SUMMARY_ERRORS: Record<string, string> = {
  NEWS_ARTICLE_INVALID: "요약할 기사가 올바르지 않습니다. 본문 전체가 들어 있는지 보아 주세요.",
  NEWS_SUMMARY_KEY_MISSING: "요약에 쓸 Gemini 키가 없습니다. API 설정에서 넣어 주세요.",
  NEWS_DAILY_LIMIT_REACHED: "오늘 쓸 수 있는 요약 횟수를 다 썼습니다. 이 앱이 막고 있는 것이고, 내일 다시 쓰실 수 있습니다.",
  NEWS_LEDGER_UNREADABLE: "사용 기록 파일을 읽을 수 없어 오늘 쓴 횟수를 확인하지 못했습니다. 확인하기 전에는 요약을 부르지 않습니다. 다시 누르셔도 같은 결과이니 news_call_usage.json 을 확인해 주세요.",
  NEWS_SUMMARY_FAILED: "요약을 받지 못했습니다. 다시 누르시면 오늘 쓸 수 있는 횟수를 한 번 더 씁니다.",
};

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
    /* 🟠 The screen's own sentence wins over the server's for a code this app knows. They say the same thing
       today — and on the day they stop, the one a person reads is the one somebody can see while editing the
       screen, rather than a string arriving from a process they are not looking at. */
    const carriedMessage = (body as { message?: unknown } | null)?.message;
    const message = SUMMARY_ERRORS[code]
      ?? (typeof carriedMessage === "string" ? carriedMessage : INTERNAL_ERROR.message);
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

/**
 * Ask the server for a summary. **This is the one call in this screen that costs the day's allowance.**
 *
 * 🔴 Every refusal is an exception here, unlike `fetchNewsArticle` — and the difference is real rather
 * than stylistic. The fetch's four outcomes are all *answers*: the server did the work and the page was what it
 * was. Here there is either a summary or nothing, and the reason it is nothing changes what the person should
 * do next — which is what `NewsApiError.code` carries (`NEWS_DAILY_LIMIT_REACHED`, `NEWS_LEDGER_UNREADABLE`,
 * `NEWS_SUMMARY_KEY_MISSING`, `NEWS_SUMMARY_FAILED`, `NEWS_ARTICLE_INVALID`).
 *
 * 🟠 A summary that invented a figure is **not** a failure and does not throw. It comes back with `check`,
 * because the person has to see *which* figure. The card button is what stays shut.
 */
export function createNewsSummary(article: NewsArticleInput): Promise<CreateNewsSummaryResponse> {
  const request: CreateNewsSummaryRequest = { article };
  return read(API_ROUTES.newsSummaries, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, isCreateNewsSummaryResponse);
}
