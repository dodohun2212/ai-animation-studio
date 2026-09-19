import { NEWS_SUMMARY_MAX_CHARS, type NewsArticleInput } from "@ai-animation-studio/shared";

import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";

/**
 * The one paid-capable call in the news reel, and the only place a provider is spoken to.
 *
 * 🔴 **The prompt below is not what makes this safe.** A model told not to invent figures invents fewer of
 * them and still invents some — that is the whole reason `checkNewsSummary` exists and runs on every answer
 * this returns. The instructions are worth writing because they shift the odds; nothing here should be read as
 * a guarantee, and no future edit to them should be treated as making the check less necessary.
 */

/**
 * 🟠 The free-tier model, named once.
 *
 * 캡틴D chose the free tier (Cowork Round 936 §1), and this is the model that tier serves. It is written here
 * rather than guessed at each call site, and like the 4:5 image size before it, **the first real request is
 * what confirms it** — a wrong name is a 404 with nothing charged, which is the cheap way to be wrong.
 */
export const GEMINI_SUMMARY_MODEL = "gemini-2.0-flash";

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/** How long one summary request may take. A person is waiting on this with a screen open. */
export const GEMINI_SUMMARY_TIMEOUT_MS = 30_000;

export class NewsSummaryProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "NewsSummaryProviderError";
  }
}

export interface GeminiSummaryDeps {
  fetch?: typeof globalThis.fetch;
  model?: string;
  timeoutMs?: number;
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
  if (!Array.isArray(parts)) throw new NewsSummaryProviderError("The summary response had no content.");
  const text = parts
    .map((part) => (typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("")
    .trim();
  if (!text) throw new NewsSummaryProviderError("The summary response was empty.");
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
  const call = deps.fetch ?? globalThis.fetch;
  // D-016: a test process must never reach a real provider with whatever key happens to sit on disk.
  assertRealNetworkCallAllowed("Gemini", call);

  let response: Response;
  try {
    response = await call(ENDPOINT(deps.model ?? GEMINI_SUMMARY_MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt(article) }] }],
        // Low temperature is not a safety measure either; it just makes the model stick closer to the text.
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? GEMINI_SUMMARY_TIMEOUT_MS),
    });
  } catch {
    throw new NewsSummaryProviderError("The summary provider could not be reached.");
  }

  if (!response.ok) {
    // 🟠 The status travels because 429 is the one the person can act on — it is the free tier's own refusal,
    // arriving after ours would have. Anything else is ours to look at, not theirs.
    throw new NewsSummaryProviderError(`The summary provider refused the request (${response.status}).`, response.status);
  }
  return textOf(await response.json().catch(() => null));
}
