import { describe, expect, it } from "vitest";

import { BUDGET_LEDGER_UNREADABLE } from "./budgetLedgerError.js";
import { StoryPromptApiError, toStoryDisplayError } from "./storyPromptApi.js";

/**
 * 🔴 This module had no tests at all, and that is exactly how three server codes came to have no sentence.
 *
 * 캡틴D pressed 승인 on the script screen and read 「요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.」 —
 * the unknown-error fallback. The backend's `StoryErrorCode` is a closed list of eleven; this client's table
 * knew eight. The three it did not know (`STORY_GENERATION_NOT_ALLOWED` · `STORY_PROMPT_STORAGE_ERROR` ·
 * `STORY_GENERATION_FAILED`) all fell to one sentence that says neither where it stopped nor whether money
 * moved. Same defect as narration's `server_error` (Round 769), except a person was standing in front of it.
 *
 * The list below is the backend's own (`apps/backend/src/story/story-api.error.ts`). Retyping it here is a
 * second copy — the same objection raised for the OpenAI categories before shared published them — so if that
 * union is ever exported, this should read it instead.
 */
const BACKEND_CODES = [
  "INVALID_REQUEST",
  "PROJECT_NOT_FOUND",
  "PROJECT_LOCKED",
  "STORY_PROMPT_STALE",
  "STORY_PROMPT_STORAGE_ERROR",
  "STORY_GENERATION_NOT_ALLOWED",
  "STORY_GENERATION_FAILED",
  "STORY_BUDGET_EXCEEDED",
  "STORY_PROVIDER_ERROR",
  "STORY_REGENERATION_NOT_ALLOWED",
  BUDGET_LEDGER_UNREADABLE,
];

describe("storyPromptApi", () => {
  const displayed = (code: string, details?: Record<string, unknown>) =>
    toStoryDisplayError(new StoryPromptApiError(code, "C:\\Users\\raw\\backend detail", details));

  it("gives every code the backend can send its own sentence, and never the backend's own words", () => {
    // 그 문장을 여기 적는 대신 모듈에게 모르는 코드를 넣어 직접 물어봅니다 — 문구를 다듬어도 짝이 느슨해지지 않게.
    const fallback = displayed("NOT_A_REAL_CODE").message;

    for (const code of BACKEND_CODES) {
      const result = displayed(code);
      expect(result.code, code).toBe(code);
      expect(result.message, code).not.toBe(fallback);
      expect(result.message, code).not.toContain("raw");
      expect(result.message, code).not.toContain("C:\\");
    }
  });

  /**
   * 🔴 돈. 세 코드는 「요청이 나갔는가」가 서로 다르고, 사람이 다음에 할 일도 그래서 다릅니다.
   * 한 문장으로 묶으면 그중 둘은 거짓말이 됩니다.
   */
  it("says whether the request was sent, because that decides what pressing again costs", () => {
    // 보내기 전 거절 — 이 말을 안 하면 사람은 돈이 나갔는지 모른 채 다시 누릅니다.
    expect(displayed("STORY_GENERATION_NOT_ALLOWED").message).toContain("보내지 않았습니다");
    expect(displayed("STORY_BUDGET_EXCEEDED").message).toContain("보내지 않았습니다");

    // 보낸 뒤 — 이미 만들어진 것이 있을 수 있으니 확인부터 시킵니다.
    expect(displayed("STORY_PROMPT_STORAGE_ERROR").message).toContain("확인해 주세요");
    expect(displayed("STORY_PROMPT_STORAGE_ERROR").message).not.toContain("보내지 않았습니다");

    // 보낸 뒤, 원인 모름 — 청구 가능성을 숨기지 않습니다.
    expect(displayed("STORY_GENERATION_FAILED").message).toContain("청구");
    expect(displayed("STORY_GENERATION_FAILED").message).not.toContain("보내지 않았습니다");
  });

  it("picks the provider sentence by category and falls back rather than echoing the server", () => {
    expect(displayed("STORY_PROVIDER_ERROR", { category: "safety_policy" }).message).toContain("안전 정책");
    expect(displayed("STORY_PROVIDER_ERROR", { category: "quota_or_permission" }).message).toContain("계정");

    const unfamiliar = displayed("STORY_PROVIDER_ERROR", { category: "something_new" });
    expect(unfamiliar.message).toContain("OpenAI");
    expect(unfamiliar.message).not.toContain("raw");
  });

  it("does not claim anything about an error it did not come from", () => {
    expect(toStoryDisplayError(new Error("boom")).code).toBe("CLIENT_UNKNOWN_ERROR");
    expect(toStoryDisplayError(undefined).code).toBe("CLIENT_UNKNOWN_ERROR");
  });
});
