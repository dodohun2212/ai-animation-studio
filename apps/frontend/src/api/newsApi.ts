import {
  API_ROUTES,
  NEWS_SUMMARY_MAX_CHARS,
  type CreateNewsSummaryRequest,
  type CreateNewsSummaryResponse,
  type NewsArticleInput,
  type NewsClaimCheck,
  type NewsSummaryCheck,
} from "@ai-animation-studio/shared";
import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

/**
 * Summarising one news article, and the refusal that is the point of the feature.
 *
 * A summariser invents plausible figures, dates and quotations. On a flower reel that is a dull mistake; on the
 * news it is a machine for making wrong things look good and sending them out. So the server checks the summary's
 * numbers, dates and quoted strings against the article it was given, and **refuses** when one of them is not
 * there — `NEWS_SUMMARY_UNSUPPORTED_CLAIM` carries the check so the screen can show which spans were invented.
 *
 * 🔴 There is no override and this module must never grow one. An override becomes the ordinary path, and this
 * is the kind of mistake that leaves the building.
 */
export class NewsApiError extends Error {
  readonly code: string;
  /** The check, when the server sent one — a refusal is only actionable if it names what was not in the article. */
  readonly check?: NewsSummaryCheck;

  constructor(code: string, message: string, check?: NewsSummaryCheck) {
    super(message);
    this.name = "NewsApiError";
    this.code = code;
    this.check = check;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "기사 내용을 확인해 주세요. 제목·본문·언론사·원문 링크가 모두 있어야 합니다.",
  /*
   * 🔴 The sentence names the cause and the only real next step. "다시 시도" would be wrong twice over: the same
   * article and the same model tend to invent the same thing, and a retry costs another paid call for it.
   */
  NEWS_SUMMARY_UNSUPPORTED_CLAIM: "요약에 기사 원문에서 찾을 수 없는 내용이 있어 만들지 않았습니다. 아래 항목을 원문과 대조해 보시고, 기사를 다시 고르거나 원문을 다시 붙여넣어 주세요.",
  NEWS_SUMMARY_FAILED: "요약을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toNewsDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof NewsApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

/**
 * The sentence a screen puts beside any check result, every time it shows one.
 *
 * 🔴 Not decoration. The check compares numbers, dates and quoted strings; it cannot see whether a causal claim
 * is supported. Without this line on screen, a green result reads as "this summary is true", which is a
 * guarantee nothing here gives. Exported so the words cannot drift between the places that show a check.
 */
export const NEWS_CHECK_SCOPE_NOTICE = "숫자·날짜·인용문만 원문과 대조했습니다. 문장의 뜻이 맞는지는 대조하지 않습니다.";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isClaim = (value: unknown): value is NewsClaimCheck =>
  isRecord(value)
  && (value.kind === "number" || value.kind === "date" || value.kind === "quote")
  && typeof value.text === "string" && value.text.trim().length > 0
  && typeof value.found === "boolean";

/**
 * A check is only usable if `missing` really is the unfound claims.
 *
 * 🔴 Checked here and not merely typed. The screen blocks on `missing` while the person reads `claims`, so a
 * response where the two disagree would show a clean summary over a list recording an invention — the exact
 * failure the refusal exists to prevent, arriving through the success path instead. `assertNewsSummaryCheck`
 * holds the same rule on the server; this is the client refusing to believe a server that broke it.
 */
const isCheck = (value: unknown): value is NewsSummaryCheck => {
  if (!isRecord(value) || !Array.isArray(value.claims) || !Array.isArray(value.missing)) return false;
  if (!value.claims.every(isClaim) || !value.missing.every(isClaim)) return false;
  const notFound = (value.claims as NewsClaimCheck[]).filter((claim) => !claim.found);
  const missing = value.missing as NewsClaimCheck[];
  return missing.length === notFound.length
    && missing.every((item, index) => item.text === notFound[index]!.text && item.kind === notFound[index]!.kind);
};

const isCreateNewsSummaryResponse = (value: unknown): value is CreateNewsSummaryResponse =>
  isRecord(value)
  && typeof value.summary === "string" && value.summary.trim().length > 0
  && value.summary.length <= NEWS_SUMMARY_MAX_CHARS
  && isCheck(value.check);

/**
 * Summarise one article and get the check with it. One paid call.
 *
 * The article travels whole — body included — because the check can only look for spans inside text the server
 * holds. That is also why a source that publishes headlines only cannot be used for this at all.
 */
export async function createNewsSummary(article: NewsArticleInput): Promise<CreateNewsSummaryResponse> {
  const request: CreateNewsSummaryRequest = { article };
  let response: Response;
  try {
    response = await fetch(API_ROUTES.newsSummaries, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new NewsApiError(NETWORK.code, NETWORK.message);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const carriedCode = isRecord(body) && typeof body.code === "string" && body.code.trim() ? body.code : MALFORMED.code;
    if (isServerUnavailable(response.status, carriedCode)) {
      throw new NewsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    // The refusal's whole value is the list it carries, so it is kept — but only when it is internally consistent.
    const details = isRecord(body) && isRecord(body.details) ? body.details : undefined;
    const check = details && isCheck(details.check) ? details.check : undefined;
    throw new NewsApiError(carriedCode, "", check);
  }
  if (!isCreateNewsSummaryResponse(body)) throw new NewsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}
