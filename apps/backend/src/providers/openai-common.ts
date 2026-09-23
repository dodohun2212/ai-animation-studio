/**
 * Shared OpenAI HTTP error classification and Korean messages, reused by every real OpenAI adapter
 * (Story, Image, ...) — mirrors Python's `app/adapters/openai_common.py`, which the same two adapters share.
 */

import type { OpenAiErrorCategory } from "@ai-animation-studio/shared";

import { redactSecrets } from "../settings/provider-settings.redaction.js";

// The list lives in the contract now, so the screens' sentence tables can be keyed on it (OPENAI_ERROR_CATEGORIES).
export type { OpenAiErrorCategory };

export const OPENAI_KOREAN_MESSAGES: Record<OpenAiErrorCategory, string> = {
  authentication: "OpenAI API 키 인증에 실패했습니다.",
  quota_or_permission: "OpenAI 사용 한도 또는 프로젝트 권한을 확인하세요.",
  rate_limit: "OpenAI 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
  server: "OpenAI 서버의 일시적인 오류가 반복되었습니다.",
  network: "OpenAI 연결 시간이 초과되거나 네트워크 연결에 실패했습니다.",
  invalid_request: "모델 또는 요청 형식이 지원되지 않습니다.",
  safety_policy: "안전 정책에 따라 요청이 거부되었습니다. 자동 재시도하지 않습니다.",
  context_length_exceeded: "설정 내용이 모델이 처리할 수 있는 길이를 초과했습니다. 세계관·전체 줄거리·캐릭터 설명 등을 줄여서 다시 시도하세요.",
  unknown: "OpenAI 요청을 완료하지 못했습니다.",
};

export const OPENAI_RETRYABLE_CATEGORIES = new Set<OpenAiErrorCategory>(["rate_limit", "server", "network"]);
export const OPENAI_MAX_BACKOFF_SECONDS = 4;
/**
 * Still the default for every OpenAI call whose retry is actually safe (a status check, a read) — but every
 * generation adapter (Image/Edit/Story/TTS/Episode-planner) forces `maxRetries: 0` on its own POST regardless of
 * this default or whatever a caller passes, the same way runway-video-adapter.ts does for task creation. A
 * `fetch` throw only means the response never reached us, never that OpenAI never received or acted on the
 * request — generation is billed and non-idempotent, so retrying it can create and pay for a second real result
 * while only ever tracking whichever attempt's response we happened to get (found
 * by re-checking every OpenAI adapter against the same bug already confirmed and fixed for Runway).
 */
export const OPENAI_DEFAULT_MAX_RETRIES = 2;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What the refusal itself said, kept beside the bucket we sorted it into.
 *
 * 🔴 Our category is a bucket; `providerMessage` is the only thing that says **what to change**. Nine
 * categories cover every refusal OpenAI can send, so `safety_policy` is one sentence for "the prompt was
 * refused", "the reference picture was refused" and "both" — and the difference is in their sentence, which
 * this file used to read for classification and then drop on the floor.
 */
export interface OpenAiHttpFailure {
  category: OpenAiErrorCategory;
  /** Verbatim, redacted and capped. Absent when the response carried no usable sentence. */
  providerMessage?: string;
  /** The provider's `x-request-id`, absent when the response carried none — the one thing their support can look up. */
  providerRequestId?: string;
}

/**
 * 🟠 A guard, not an editor. Real refusals run 80–200 characters; a body long enough to hit this is not a
 * sentence anyone meant us to show, and it is on its way into a project's own file. Truncation is visible
 * (`…`) because a sentence that was cut must not read as one that ended.
 */
export const PROVIDER_MESSAGE_MAX_CHARS = 400;

export class OpenAiAdapterError extends Error {
  /**
   * `failure` carries what the provider said. Optional because two categories are ours rather than theirs
   * (`empty_response`/`invalid_response`): OpenAI answered 200 and there was nothing to quote.
   */
  constructor(
    public readonly category: OpenAiErrorCategory | "empty_response" | "invalid_response",
    message: string,
    public readonly failure?: Pick<OpenAiHttpFailure, "providerMessage" | "providerRequestId">,
  ) {
    super(message);
  }
}

/**
 * One read of the error body, in both the shape that classifies and the shape a person reads.
 *
 * 🔴 `spoken` is the same string as `message` before it was lowercased. Classification wants it folded; a
 * person wants it as the provider wrote it, and the two were never the same string — the lowercased one was
 * simply the only one that existed.
 */
interface OpenAiErrorBody { code: string; message: string; spoken: string }

async function readOpenAiErrorBody(response: Response): Promise<OpenAiErrorBody> {
  try {
    const body: unknown = await response.json();
    if (isObject(body) && isObject(body.error)) {
      const spoken = typeof body.error.message === "string" ? body.error.message : "";
      return {
        code: typeof body.error.code === "string" ? body.error.code.toLowerCase() : "",
        message: spoken.toLowerCase(),
        spoken,
      };
    }
  } catch { /* an unparsable error body still classifies by status */ }
  return { code: "", message: "", spoken: "" };
}

/**
 * The provider's sentence, safe to write into a project's own file and show on a screen.
 *
 * 🔴 Redacted first and always. This string is about to be persisted and rendered, and the one rule this
 * repository does not bend is that a secret never reaches a log, a response or a commit (AGENTS.md). OpenAI has
 * no reason to echo a key, which is exactly why nobody would notice the day one did.
 */
function presentableProviderMessage(spoken: string): string {
  const redacted = redactSecrets(spoken).trim();
  if (!redacted) return "";
  return redacted.length > PROVIDER_MESSAGE_MAX_CHARS ? `${redacted.slice(0, PROVIDER_MESSAGE_MAX_CHARS)}…` : redacted;
}

/**
 * The same classification this file has always done, with the provider's own words carried out alongside it.
 *
 * `classifyOpenAiHttpError` stays beside it as the narrow view, because most callers only ever wanted the
 * bucket — and because a `Response` body can be read exactly once, so the two cannot be layered.
 */
export async function describeOpenAiHttpError(response: Response): Promise<OpenAiHttpFailure> {
  const parsed = await readOpenAiErrorBody(response);
  const providerMessage = presentableProviderMessage(parsed.spoken);
  // Read off the response, not the body: a refusal whose body will not parse still carries this header, and
  // that is the case where an id is worth the most.
  const providerRequestId = response.headers.get("x-request-id") ?? "";
  return {
    category: categoryFor(response.status, parsed),
    ...(providerMessage ? { providerMessage } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
  };
}

export async function classifyOpenAiHttpError(response: Response): Promise<OpenAiErrorCategory> {
  return categoryFor(response.status, await readOpenAiErrorBody(response));
}

function categoryFor(status: number, { code, message }: OpenAiErrorBody): OpenAiErrorCategory {
  if (status === 401) return "authentication";
  if (status === 402 || status === 403 || code === "insufficient_quota" || code === "billing_hard_limit_reached" || message.includes("insufficient_quota")) return "quota_or_permission";
  if (code === "content_policy_violation" || code === "safety_violation" || message.includes("content policy") || message.includes("safety")) return "safety_policy";
  // OpenAI's documented code for a request whose rendered prompt exceeds the model's context window — a fixed
  // character-count guard can't catch this upstream (the limit is model-dependent, not our prompt's), so the
  // adapter classifies it after the fact instead, into a category the user can actually act on (shorten settings).
  if (code === "context_length_exceeded" || message.includes("context_length_exceeded") || message.includes("maximum context length")) return "context_length_exceeded";
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
