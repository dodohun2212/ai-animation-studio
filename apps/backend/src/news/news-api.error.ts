import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

/**
 * What the summary route can refuse with.
 *
 * 🔴 Five codes rather than one, because **each leaves the person a different thing to do** — and a refusal
 * that does not name the next step is a dead end. Two of them are about money and are the reason this list is
 * not shorter: "today's allowance is gone" (wait until tomorrow, or press again after midnight) and "the
 * ledger cannot be read" (open that file; pressing again will do the same thing) are opposite instructions,
 * and collapsing them would give the second one the first one's advice.
 */
export type NewsErrorCode =
  | "NEWS_ARTICLE_INVALID"
  | "NEWS_SUMMARY_KEY_MISSING"
  | "NEWS_DAILY_LIMIT_REACHED"
  | "NEWS_LEDGER_UNREADABLE"
  | "NEWS_SUMMARY_FAILED";

export class NewsApiException extends HttpException {
  constructor(code: NewsErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
    super(body, status);
  }
}

export const newsSummaryArticleInvalid = (message = "요약할 기사가 올바르지 않습니다.") =>
  new NewsApiException("NEWS_ARTICLE_INVALID", message, HttpStatus.BAD_REQUEST);

/**
 * 🟠 Says which key and where, because "not configured" answers no question. The billing condition is not
 * repeated here — it belongs beside the field where the key is pasted (`PROVIDER_KEY_NOTES`), and saying it
 * twice is two places to keep true.
 */
export const newsSummaryKeyMissing = () =>
  new NewsApiException(
    "NEWS_SUMMARY_KEY_MISSING",
    "요약에 쓸 Gemini 키가 없습니다. API 설정에서 넣어 주세요.",
    HttpStatus.BAD_REQUEST,
  );

/**
 * 🔴 Our own cap closing, not the provider's. It says so, because a person who reads this as Google's refusal
 * will go looking at their Google console and find nothing wrong (news-call-quota.ts).
 */
export const newsDailyLimitReached = (used: number, limit: number) =>
  new NewsApiException(
    "NEWS_DAILY_LIMIT_REACHED",
    `오늘 요약을 ${used}번 불렀습니다. 이 앱이 하루 ${limit}번으로 막고 있습니다 — 내일 다시 쓰실 수 있습니다.`,
    HttpStatus.TOO_MANY_REQUESTS,
  );

/**
 * 🔴 Never "try again". The ledger reads the same way on the next press, and D-036 is exactly the case where
 * an unreadable count was treated as room to spend.
 */
export const newsLedgerUnreadable = () =>
  new NewsApiException(
    "NEWS_LEDGER_UNREADABLE",
    "사용 기록 파일을 읽을 수 없어 오늘 쓴 횟수를 확인하지 못했습니다. 확인하기 전에는 요약을 부르지 않습니다. 다시 눌러도 같은 결과이니 news_call_usage.json 을 확인해 주세요.",
    HttpStatus.INTERNAL_SERVER_ERROR,
  );

/**
 * 🟠 The one that may be worth retrying — and it costs a call, so the sentence says so rather than inviting a
 * press whose price is invisible.
 */
export const newsSummaryFailed = () =>
  new NewsApiException(
    "NEWS_SUMMARY_FAILED",
    "요약을 받지 못했습니다. 다시 누르시면 오늘 쓸 수 있는 횟수를 한 번 더 씁니다.",
    HttpStatus.BAD_GATEWAY,
  );
