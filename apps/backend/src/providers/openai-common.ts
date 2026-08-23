/**
 * Shared OpenAI HTTP error classification and Korean messages, reused by every real OpenAI adapter
 * (Story, Image, ...) — mirrors Python's `app/adapters/openai_common.py`, which the same two adapters share.
 */

export type OpenAiErrorCategory =
  | "authentication" | "quota_or_permission" | "rate_limit" | "server" | "network"
  | "invalid_request" | "safety_policy" | "unknown";

export const OPENAI_KOREAN_MESSAGES: Record<OpenAiErrorCategory, string> = {
  authentication: "OpenAI API 키 인증에 실패했습니다.",
  quota_or_permission: "OpenAI 사용 한도 또는 프로젝트 권한을 확인하세요.",
  rate_limit: "OpenAI 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
  server: "OpenAI 서버의 일시적인 오류가 반복되었습니다.",
  network: "OpenAI 연결 시간이 초과되거나 네트워크 연결에 실패했습니다.",
  invalid_request: "모델 또는 요청 형식이 지원되지 않습니다.",
  safety_policy: "안전 정책에 따라 요청이 거부되었습니다. 자동 재시도하지 않습니다.",
  unknown: "OpenAI 요청을 완료하지 못했습니다.",
};

export const OPENAI_RETRYABLE_CATEGORIES = new Set<OpenAiErrorCategory>(["rate_limit", "server", "network"]);
export const OPENAI_MAX_BACKOFF_SECONDS = 4;
export const OPENAI_DEFAULT_MAX_RETRIES = 2;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export class OpenAiAdapterError extends Error {
  constructor(public readonly category: OpenAiErrorCategory | "empty_response" | "invalid_response", message: string) {
    super(message);
  }
}

export async function classifyOpenAiHttpError(response: Response): Promise<OpenAiErrorCategory> {
  const status = response.status;
  let code = ""; let message = "";
  try {
    const body: unknown = await response.json();
    if (isObject(body) && isObject(body.error)) {
      code = typeof body.error.code === "string" ? body.error.code.toLowerCase() : "";
      message = typeof body.error.message === "string" ? body.error.message.toLowerCase() : "";
    }
  } catch { /* an unparsable error body still classifies by status */ }
  if (status === 401) return "authentication";
  if (status === 402 || status === 403 || code === "insufficient_quota" || code === "billing_hard_limit_reached" || message.includes("insufficient_quota")) return "quota_or_permission";
  if (code === "content_policy_violation" || code === "safety_violation" || message.includes("content policy") || message.includes("safety")) return "safety_policy";
  if (status === 429) return "rate_limit";
  if (status >= 500 && status <= 599) return "server";
  if (status === 400) return "invalid_request";
  return "unknown";
}

export function parseRetryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : null;
}

export function defaultSleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export function backoffSeconds(attempt: number): number {
  return Math.min(OPENAI_MAX_BACKOFF_SECONDS, 0.5 * 2 ** attempt);
}
