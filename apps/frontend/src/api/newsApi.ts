import {
  API_ROUTES,
  type CreateNewsReelCardTextRequest,
  type CreateNewsReelCardTextResponse,
  type CreateNewsSummaryRequest,
  type CreateNewsSummaryResponse,
  isCreateNewsSummaryResponse,
  isNewsFeedResponse,
  isNewsFetchArticleResponse,
  isNewsReelSetupResponse,
  type NewsArticleInput,
  NEWS_REEL_TEXT_FIELDS,
  type NewsReelTextField,
  type NewsFeedResponse,
  type NewsFetchArticleRequest,
  type NewsFetchArticleResponse,
  type NewsReelSetupResponse,
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
/**
 * 장부를 못 읽었을 때의 한 문장 — **두 자리에서 같은 말을 해야 해서** 상수입니다.
 *
 * 하나는 요약을 눌렀다가 거절당한 자리(`NEWS_LEDGER_UNREADABLE`), 다른 하나는 화면이 **열리자마자**
 * `GET /news/setup` 이 `dailyCalls: null` 로 답하는 자리입니다. 같은 파일이 같은 이유로 안 읽히는 것이고,
 * 사람이 할 일도 같습니다 — 그래서 문장이 갈라지면 둘 중 하나는 반드시 틀립니다.
 *
 * 🔴 「이번 달 사용액」을 말하는 `BUDGET_LEDGER_UNREADABLE_MESSAGE` 를 **재활용하지 않습니다.** 이건 **오늘 ·
 * 호출 수**고 그건 **이번 달 · 달러**입니다. 한 번 합쳤다가 CLI Round 935 §1 에서 잡혔는데, 그대로 썼으면 사람이
 * `api_budget_usage.json` 을 열어 보고 멀쩡한 걸 확인한 뒤 「그럼 왜 막혔지」로 갔을 겁니다. 그래서 **파일 이름을
 * 문장에 적습니다.**
 */
export const NEWS_LEDGER_UNREADABLE_MESSAGE =
  "사용 기록 파일을 읽을 수 없어 오늘 쓴 횟수를 확인하지 못했습니다. 확인하기 전에는 요약을 부르지 않습니다. 다시 누르셔도 같은 결과이니 news_call_usage.json 을 확인해 주세요.";

const SUMMARY_ERRORS: Record<string, string> = {
  NEWS_ARTICLE_INVALID: "요약할 기사가 올바르지 않습니다. 본문 전체가 들어 있는지 보아 주세요.",
  NEWS_SUMMARY_KEY_MISSING: "요약에 쓸 Gemini 키가 없습니다. API 설정에서 넣어 주세요.",
  NEWS_DAILY_LIMIT_REACHED: "오늘 쓸 수 있는 요약 횟수를 다 썼습니다. 이 앱이 막고 있는 것이고, 내일 다시 쓰실 수 있습니다.",
  NEWS_LEDGER_UNREADABLE: NEWS_LEDGER_UNREADABLE_MESSAGE,
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
 * 오늘 들어온 기사 목록.
 *
 * 🔴 **여기 한 행은 「더 믿을 수 있는 길」이 아닙니다.** 누르면 주소 칸이 채워질 뿐이고, 본문은 여전히
 * `fetchNewsArticle` 로 갑니다 — 같은 허용 목록, 같은 리다이렉트 검사. **주소를 손으로 치는 수고가 없어지는
 * 것뿐**입니다.
 *
 * 🟠 목록을 못 받아도 화면은 그대로 씁니다 — 주소를 손으로 넣는 길이 원래 길이고, 이건 지름길입니다.
 * 그래서 화면이 이 실패를 **빨간 상자가 아니라 한 줄**로 말합니다.
 */
export function getNewsFeed(): Promise<NewsFeedResponse> {
  return read(API_ROUTES.newsFeed, undefined, isNewsFeedResponse);
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

/**
 * 답의 모양을 여기서 검사합니다 — 계약이 아니라 **부르는 쪽**에서.
 *
 * 🟠 CLI 가 라우트를 낼 때 가드를 일부러 안 만들었습니다(라우트를 낸 쪽이 일부러 남겨 둔 자리): *「부르는 쪽이 생길 때 그 자리에서」*.
 * 지금 그 자리가 생겼습니다.
 *
 * 🔴 **칸 이름을 손으로 안 적습니다.** `NEWS_REEL_TEXT_FIELDS` 로 거릅니다 — 다섯째 칸이 생기는 날, 손으로 적은
 * 목록은 **조용히 그 칸을 버립니다**(docs/06_DECISIONS.md D-052 의 같은 이유).
 *
 * 🟠 **`values` 가 비어 있어도 통과시킵니다.** 한 칸도 못 읽은 답은 **모양이 틀린 게 아니라 내용이 없는 것**이고,
 * 그건 `missing` 이 말합니다. 여기서 거절하면 **돈이 나간 답을 통째로 버리면서 이유는 「서버 응답 이상」**이 됩니다.
 */
function isCreateNewsReelCardTextResponse(value: unknown): value is CreateNewsReelCardTextResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  const isField = (one: unknown): one is NewsReelTextField =>
    typeof one === "string" && (NEWS_REEL_TEXT_FIELDS as readonly string[]).includes(one);
  /* 자막 칸은 어느 그림인지(`scene`)를 같이 들고 옵니다 — 제목 칸에는 없습니다. */
  const isSlot = (one: unknown): boolean => {
    if (typeof one !== "object" || one === null) return false;
    const slot = one as { field?: unknown; scene?: unknown };
    return isField(slot.field) && (slot.scene === undefined || (Number.isInteger(slot.scene) && (slot.scene as number) >= 0));
  };
  const isSlotList = (list: unknown): boolean => Array.isArray(list) && list.every(isSlot);
  /* 한 줄도 못 읽은 칸은 빈 객체로 옵니다 — 그 그림도 그림이라 자리를 지킵니다. */
  const isLines = (one: unknown, keys: readonly string[]): boolean =>
    typeof one === "object" && one !== null && !Array.isArray(one)
    && Object.entries(one as Record<string, unknown>).every(([key, line]) => keys.includes(key) && typeof line === "string");

  if (!isLines(candidate.headline, ["line1", "line2"])) return false;
  if (!Array.isArray(candidate.captions) || !candidate.captions.every((one) => isLines(one, ["line1", "line2"]))) return false;
  if (!isSlotList(candidate.missing) || !isSlotList(candidate.repeated)) return false;
  if (!Array.isArray(candidate.ignored) || !candidate.ignored.every((one) => typeof one === "string")) return false;

  const check = candidate.check as { claims?: unknown; missing?: unknown } | null;
  if (typeof check !== "object" || check === null) return false;
  if (!Array.isArray(check.claims) || !Array.isArray(check.missing)) return false;

  const calls = candidate.dailyCalls as { used?: unknown; limit?: unknown } | null;
  if (typeof calls !== "object" || calls === null) return false;
  return Number.isInteger(calls.used) && (calls.used as number) >= 0
    && Number.isInteger(calls.limit) && (calls.limit as number) > 0;
}

/**
 * 기사 하나로 **칸 넷**을 받습니다. 🔴 **오늘 쓸 수 있는 횟수를 한 번 씁니다** — 요약과 같은 장부입니다.
 *
 * 🔴 **아무것도 안 자르고 안 고칩니다.** 긴 줄은 긴 채로 칸에 들어가고, 칸이 빨갛게 세 줍니다 — 화면에서
 * 자르면 사람은 **무엇을 잃었는지 모른 채** 굽습니다(돈이 나간 답이라 그대로 옵니다).
 *
 * 🟠 **대조는 네 줄 위에서** 돌아옵니다 — 요약이 아니라. 구워지는 게 그 줄이라서입니다.
 */
export function createNewsReelCardText(article: NewsArticleInput, sceneCount: number): Promise<CreateNewsReelCardTextResponse> {
  const request: CreateNewsReelCardTextRequest = { article, sceneCount };
  return read(API_ROUTES.newsReelCardText, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, isCreateNewsReelCardTextResponse);
}
