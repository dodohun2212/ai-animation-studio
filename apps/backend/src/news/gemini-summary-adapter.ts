import { NEWS_SUMMARY_MAX_CHARS, type NewsArticleInput } from "@ai-animation-studio/shared";

import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";
import { newsReelCardPrompt } from "./news-reel-card-text.js";

/**
 * The one paid-capable call in the news reel, and the only place a provider is spoken to.
 *
 * 🔴 **The prompt below is not what makes this safe.** A model told not to invent figures invents fewer of
 * them and still invents some — that is the whole reason `checkNewsSummary` exists and runs on every answer
 * this returns. The instructions are worth writing because they shift the odds; nothing here should be read as
 * a guarantee, and no future edit to them should be treated as making the check less necessary.
 */

/**
 * 🟢 The model, named once — **confirmed by an actual call, 2026-09-20.**
 *
 * 🔴 **Two wrong names in one day, and the second one taught the lesson.** The first was `gemini-2.0-flash`,
 * written before any key existed. Replacing it, `GET /v1beta/models` was used to pick `gemini-2.5-flash` — it
 * was in the list of 50 that the key returns. It still 404s:
 *
 * ```
 * This model models/gemini-2.5-flash is no longer available to new users.
 * Please update your code to use models/gemini-3.6-flash …
 * ```
 *
 * 🔴 **Being listed is not being callable.** `models.list` answers with what exists, not with what this
 * account may call, so the list cannot confirm a model — only a request can. This name was set by sending one
 * (`1+1은?` → `1 + 1 = 2`), which is the only check worth trusting here.
 *
 * 🟠 **Pinned, not `gemini-flash-latest`.** That alias also answers, and that is the problem: it moves, and a
 * summariser whose output changes on a day nobody deployed cannot be checked. Every answer goes through
 * `checkNewsSummary` against the article, so a silent model change is a silent change in what passes it.
 */
export const GEMINI_SUMMARY_MODEL = "gemini-3.6-flash";

/**
 * Where a request goes when {@link GEMINI_SUMMARY_MODEL} is too busy to take it, or is gone.
 *
 * 🔴 2026-09-22, 01:07–01:26: timeout, timeout, then `503 「This model is currently experiencing high demand」`
 * twice in a row (the one retry included). 캡틴D could not make a reel for twenty minutes while nothing on our
 * side was wrong.
 *
 * 🟠 **Why this name and not a better one:** it is the only other name **confirmed by an actual call**
 * (2026-09-20, see above) — a listed name proved nothing twice. The objection above to pinning the alias still
 * holds for the *usual* path, which is why it stays second: it is used only when the pinned model has refused,
 * and every answer from it goes through the same `checkNewsSummary` as the pinned model's. 🟠 It may point at the
 * same model and be just as busy — then nothing is lost but a request Google did not process.
 */
export const GEMINI_SUMMARY_FALLBACK_MODEL = "gemini-flash-latest";

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * How long one summary request may take. A person is waiting on this with a screen open.
 *
 * 🔴 **30 seconds was too short, measured.** 2026-09-22, the first night the ledger kept reasons: two presses,
 * ten minutes apart, both booked `timeout` — not a busy burst (that is a 503, retried) but a model that takes
 * longer than 30 seconds on a whole article. 🟠 Cutting it off saves nothing: the request already reached the
 * provider and is booked against the day either way, so a short ceiling spends the call and throws the answer
 * away. 90 seconds is a ceiling on a hung connection, not a wait — a fast answer still returns when it arrives.
 */
export const GEMINI_SUMMARY_TIMEOUT_MS = 90_000;

/**
 * 🔴 **Retries are for 5xx only, and there are three of them now, spaced out.**
 *
 * 캡틴D, first working day: 요약 pressed, 「요약을 받지 못했다」, pressed again, same. Probed from outside the
 * app — `gemini-3.6-flash` answers 503 「This model is currently experiencing high demand. Spikes in demand are
 * usually temporary」 and then answers 200 three times in a row a minute later. It is not down; it is busy in
 * bursts. One retry 1.5 seconds later was not enough (2026-09-22: both attempts 503), so the waits grow —
 * 2 s, 5 s, 10 s — and then the fallback model gets the same.
 *
 * 🟢 **A 503 costs nothing.** Google did not process the request; that is what the status says. So retrying one
 * spends no money, and `NewsCallQuota` books one entry per person action, not per attempt — the day's cap still
 * bounds presses.
 *
 * 🔴 **Not 429, not a timeout, not other 4xx.** A 429 is the free tier's own refusal and retrying it is what a
 * rate limit exists to stop. A timeout may have been processed — and billed — and the person has already waited
 * for it. Other 4xx fail identically next time. The one 4xx that moves to the fallback is 404: that is a model
 * name retired under us, which has happened twice.
 */
export const GEMINI_SUMMARY_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000];

export class NewsSummaryProviderError extends Error {
  /**
   * @param failure Why, in words short enough for the call ledger: `http 503: <the provider's own message>`,
   *   `timeout`, `unreachable`, `empty`. 🔴 캡틴D pressed 요약 twice on 2026-09-21 and got 「요약을 받지 못했다」
   *   both times; the ledger said `succeeded: false` and nothing else, so a busy model, a retired model name and
   *   a dead connection all read the same. The reason is booked with the call so the next one can be told apart
   *   without spending another call to find out. Never holds the key — nothing here ever sees the request headers.
   */
  constructor(message: string, readonly status?: number, readonly failure: string = "unknown") {
    super(message);
    this.name = "NewsSummaryProviderError";
  }
}

/** The provider's own error sentence, cut short — `{"error":{"message":"…"}}` is Google's shape. */
const PROVIDER_MESSAGE_MAX_CHARS = 200;
async function providerMessageOf(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
  const message = payload?.error?.message;
  return typeof message === "string" ? message.replace(/\s+/g, " ").trim().slice(0, PROVIDER_MESSAGE_MAX_CHARS) : "";
}

export interface GeminiSummaryDeps {
  fetch?: typeof globalThis.fetch;
  model?: string;
  timeoutMs?: number;
  /** Replaceable so a pair can exercise the retries without waiting for them. Replaces every wait. */
  retryDelayMs?: number;
}

/**
 * What the model is asked for.
 *
 * 🔴 「기사에 있는 말만 쓰라」 is the important line and it is also the one that cannot be enforced from here.
 * It is followed by the check, not replaced by it.
 *
 * 🟠 The length limit is stated in characters because `NEWS_SUMMARY_MAX_CHARS` is what the card can hold —
 * until now that constant had **no readers at all**, which is its own small warning: a named limit nothing
 * consults is a number somebody will one day believe is being enforced.
 */
function prompt(article: NewsArticleInput): string {
  return [
    "아래 기사를 한국어로 요약해 주세요.",
    "",
    `- ${NEWS_SUMMARY_MAX_CHARS}자 이내로 씁니다.`,
    "- **기사 본문에 있는 내용만** 씁니다. 숫자·날짜·인용문은 기사에 적힌 그대로만 쓰고, 기사에 없는 것은 절대 만들어 넣지 않습니다.",
    "- 배경 설명이나 추측을 보태지 않습니다. 기사가 말하지 않은 원인·결과를 쓰지 않습니다.",
    "- 요약문만 출력합니다. 머리말, 따옴표, 목록 기호를 붙이지 않습니다.",
    "",
    `제목: ${article.title}`,
    "",
    "본문:",
    article.body,
  ].join("\n");
}

/** The one shape we read out of the response, with every step of it checked rather than assumed. */
function textOf(payload: unknown): string {
  const candidate = (payload as { candidates?: unknown[] } | null)?.candidates?.[0];
  const parts = (candidate as { content?: { parts?: unknown[] } } | undefined)?.content?.parts;
  if (!Array.isArray(parts)) throw new NewsSummaryProviderError("The summary response had no content.", undefined, "empty");
  const text = parts
    .map((part) => (typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("")
    .trim();
  if (!text) throw new NewsSummaryProviderError("The summary response was empty.", undefined, "empty");
  return text;
}

/**
 * Ask the provider for one summary.
 *
 * 🔴 Throwing and returning are **both** a call that happened. Whoever calls this books it against the day
 * either way — a request that reached the provider and failed still consumed whatever they count, and a cap
 * that only counted successes would let a failing retry loop run all day (news-call-quota.ts).
 */
export async function summariseArticle(
  article: NewsArticleInput,
  apiKey: string,
  deps: GeminiSummaryDeps = {},
): Promise<string> {
  return askGemini(prompt(article), apiKey, deps);
}

/**
 * Ask for a news reel card's four lines instead of a summary.
 *
 * 🔴 **The same request, the same retry, the same day's count — a different question.** What differs is the
 * prompt and nothing else, which is the point: two ways of reaching this provider would mean two places for
 * the timeout, the one 5xx retry and the model name to drift apart, and the model name has already been wrong
 * twice (see {@link GEMINI_SUMMARY_MODEL}).
 */
export async function writeNewsReelCardText(
  article: NewsArticleInput,
  apiKey: string,
  deps: GeminiSummaryDeps = {},
): Promise<string> {
  return askGemini(newsReelCardPrompt(article), apiKey, deps);
}

/** One request to the provider, with the retries, the fallback and the timeout the whole feature shares. */
async function askGemini(promptText: string, apiKey: string, deps: GeminiSummaryDeps): Promise<string> {
  const call = deps.fetch ?? globalThis.fetch;
  // D-016: a test process must never reach a real provider with whatever key happens to sit on disk.
  assertRealNetworkCallAllowed("Gemini", call);

  const send = async (model: string): Promise<Response> => {
    try {
      return await call(ENDPOINT(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          // Low temperature is not a safety measure either; it just makes the model stick closer to the text.
          generationConfig: { temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(deps.timeoutMs ?? GEMINI_SUMMARY_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new NewsSummaryProviderError("The summary provider could not be reached.", undefined, `${model} ${timedOut ? "timeout" : "unreachable"}`);
    }
  };
  const wait = (ms: number) => new Promise((resume) => setTimeout(resume, deps.retryDelayMs ?? ms));

  const models = deps.model ? [deps.model] : [GEMINI_SUMMARY_MODEL, GEMINI_SUMMARY_FALLBACK_MODEL];
  let refused: NewsSummaryProviderError | undefined;
  for (const model of models) {
    let response = await send(model);
    for (const delay of GEMINI_SUMMARY_RETRY_DELAYS_MS) {
      if (response.status < 500) break;
      await wait(delay);
      response = await send(model);
    }
    if (response.ok) return textOf(await response.json().catch(() => null));

    // 🟠 The status travels because 429 is the one the person can act on — it is the free tier's own refusal,
    // arriving after ours would have. Anything else is ours to look at, not theirs.
    const said = await providerMessageOf(response);
    refused = new NewsSummaryProviderError(
      `The summary provider refused the request (${response.status}).`,
      response.status,
      said ? `${model} http ${response.status}: ${said}` : `${model} http ${response.status}`,
    );
    // Only "busy" and "that model is gone" are worth another model; anything else would fail there too.
    if (response.status < 500 && response.status !== 404) break;
  }
  throw refused!;
}
