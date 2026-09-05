import { INTERNAL_ERROR_CODE } from "@ai-animation-studio/shared";

/**
 * "The backend did not answer" — one code, one sentence, and the test that recognises it.
 *
 * 🔴 Two modules already learned this and sixteen did not. `projectsApi` and `providerSettingsApi` carry a
 * branch whose own comment says it: a 5xx that does not even carry the backend's `{ code, message }` shape
 * means the backend never answered — it is down, restarting, or a dev proxy replied instead — and reporting
 * that as "the response could not be read" tells a person nothing they can act on.
 *
 * Every other module still reports it as a malformed response. On 2026-09-05 the backend process died for
 * thirteen minutes and both sentences were on screen at once, on different screens, for the same outage:
 *
 *     프로젝트 목록 · API 설정   "서버가 응답하지 않습니다. 서버가 재시작 중이거나 꺼져 있을 수 있습니다…"
 *     그 밖의 모든 화면          "서버 응답을 확인할 수 없습니다."
 *
 * The second one blames the response for a server that was not running. Adopting this is two lines in a
 * module's `request()` plus letting the code through its own display-error table — see projectsApi for the
 * shape. It is a widening: the only responses that reach this branch are ones that already produced the worse
 * sentence.
 */
export const SERVER_UNAVAILABLE_ERROR = {
  code: "CLIENT_SERVER_UNAVAILABLE",
  message: "서버가 응답하지 않습니다. 서버가 재시작 중이거나 꺼져 있을 수 있습니다. 잠시 후 다시 시도해 주세요.",
} as const;

/**
 * The code every module gives a response it could not read as the backend's error shape.
 *
 * Shared because the test below turns on it. The *message* beside it is deliberately not shared: those differ
 * per module today, and unifying wording is a separate decision from unifying this rule.
 */
export const MALFORMED_RESPONSE_CODE = "CLIENT_MALFORMED_RESPONSE";

/**
 * Whether a failed response is the backend not answering, rather than answering badly.
 *
 * Both halves are needed. A 5xx that *does* carry the backend's error shape is the backend answering — it has
 * a code and a sentence of its own, and this must not overwrite them. A malformed body under a 4xx is a
 * genuinely unreadable answer from something that did answer.
 */
export function isServerUnavailable(status: number, apiErrorCode: string): boolean {
  return status >= 500 && apiErrorCode === MALFORMED_RESPONSE_CODE;
}

/**
 * The server was running and this one request fell over inside it.
 *
 * 🔴 A distinct situation from both sentences above, and until CLI's `UnexpectedErrorFilter` it could not be
 * told apart from either: an unhandled throw left Nest's own `{ statusCode, message }` body, with no `code` at
 * all, so a crash looked exactly like a dead server. Both readings were wrong, and the wrong one sends a person
 * to restart a server that is up.
 *
 * So the sentence's job is mostly to stop that: it says the server is fine, and it says how to tell a passing
 * hiccup from a step that is actually broken. It does not guess at a cause — the exception's own text goes to
 * the log, never to the screen, because a stack trace is a leak and an invented explanation is worse than a
 * plain one.
 *
 * 🟠 Not for a paid path as written. "다시 눌러도" is safe advice for reading a project or saving a setting; on
 * a screen that spends money the retry question belongs to `SceneFailure.billedOnFailure`, and a module that
 * adopts this must check that first.
 */
export const INTERNAL_ERROR = {
  code: INTERNAL_ERROR_CODE,
  message: "이 요청을 처리하다 예기치 못한 오류가 났습니다. 서버는 떠 있으니 다시 시작하실 필요는 없습니다. 다시 눌러도 같은 자리에서 나면 그 단계에 실제 문제가 있는 것입니다.",
} as const;
