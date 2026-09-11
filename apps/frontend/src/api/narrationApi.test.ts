import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NarrationApiError,
  getNarrationReview,
  narrationContentUrl,
  regenerateNarration,
  startNarrationGeneration,
  toNarrationDisplayError,
} from "./narrationApi.js";
import { jsonResponse, sceneStaleness } from "./testUtils.js";

/**
 * This module had no tests at all, so its safe-message table — the whole mechanism that keeps a backend's raw
 * message off the screen (docs/06_DECISIONS.md D-010) — was unguarded: an entry could be deleted, or a new
 * server code could arrive with none, and nothing would say so. Adding one entry is what surfaced that.
 */
const REVIEW = {
  project: { projectId: "narr", workflowState: "SCRIPT_APPROVED" },
  narrations: [{ sceneNumber: 1, narration: "읽어줄 문장", audio: "none" }],
} as const;

describe("narrationApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Same check as the image and video clients', through this client's own guard. The fixture above is
   * deliberately route-only — that test swallows the rejection — so without this one nothing here would notice
   * the staleness check being dropped.
   */
  it("refuses a review whose staleness is present and missing a required list", async () => {
    const project = { id: "narr", topic: "t", projectType: "short_project", workflowState: "SCRIPT_APPROVED", createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z", scenes: [], warnings: [], errors: [] };
    const body = { project, narrations: [], staleness: sceneStaleness() };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));
    await expect(getNarrationReview("narr")).resolves.toMatchObject({ staleness: { narrationStale: [] } });

    const { narrationStale: _dropped, ...short } = body.staleness;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ...body, staleness: short })));
    await expect(getNarrationReview("narr")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("reads the review via GET, generates via POST with explicit approval, and regenerates one scene", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, REVIEW));
    vi.stubGlobal("fetch", fetchMock);

    await getNarrationReview("narr").catch(() => undefined);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/projects/narr/narration/review");

    await startNarrationGeneration("narr").catch(() => undefined);
    const [generateUrl, generateInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(generateUrl).toBe("/projects/narr/narration/generations");
    expect(generateInit.method).toBe("POST");
    // Never an implicit start: the request carries the approval the server requires, so a stray call cannot
    // spend money by omission.
    expect(JSON.parse(String(generateInit.body))).toEqual({ approved: true });

    await regenerateNarration("narr", 1, "더 밝게").catch(() => undefined);
    const [regenerateUrl, regenerateInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(regenerateUrl).toBe("/projects/narr/narration/review/1/regenerate");
    expect(regenerateInit.method).toBe("POST");
    expect(JSON.parse(String(regenerateInit.body))).toEqual({ approved: true, additionalInstruction: "더 밝게" });
  });

  it("gives every server code its own message and never the backend's own words", () => {
    const codes = [
      "INVALID_REQUEST",
      "PROJECT_NOT_FOUND",
      "PROJECT_LOCKED",
      "NARRATION_NOT_ENABLED",
      "NARRATION_MISSING_TEXT",
      "NARRATION_GENERATION_FAILED",
      "NARRATION_STORAGE_ERROR",
      "NARRATION_BUDGET_EXCEEDED",
      "NARRATION_CONTENT_UNAVAILABLE",
    ];

    for (const code of codes) {
      const displayed = toNarrationDisplayError(new NarrationApiError(code, "C:\\\\Users\\\\raw\\\\backend detail"));
      expect(displayed.code).toBe(code);
      // Falling through to the unknown-error text is the failure this guards: the code would still look right
      // while the user reads a sentence that tells them nothing about what happened.
      expect(displayed.code).not.toBe("CLIENT_UNKNOWN_ERROR");
      expect(displayed.message).not.toContain("raw");
      expect(displayed.message.length).toBeGreaterThan(0);
    }
  });

  it("chooses a provider message by category, and falls back rather than echoing the server", () => {
    const rateLimited = toNarrationDisplayError(
      new NarrationApiError("NARRATION_PROVIDER_ERROR", "raw backend detail", { category: "rate_limit" }),
    );
    expect(rateLimited.message).toContain("일시적으로 제한");

    // An unrecognised category must still produce the module's own sentence. The category comes from the server,
    // so treating it as a lookup that always hits would put an undefined message on the screen the first time
    // the backend adds one.
    const unfamiliar = toNarrationDisplayError(
      new NarrationApiError("NARRATION_PROVIDER_ERROR", "raw backend detail", { category: "something_new" }),
    );
    expect(unfamiliar.message).toContain("OpenAI");
    expect(unfamiliar.message).not.toContain("raw backend detail");
  });

  /**
   * 위 짝은 `rate_limit` 하나만 봅니다. 그게 맞는 키였기 때문에, 같은 표 안의 `server_error` — 백엔드가
   * 한 번도 보낸 적 없는 이름 — 이 아무 진단도 없이 계속 있었습니다. `Record<string, string>` 은 틀린
   * 키를 컴파일에서 잡아주지 않으므로, 목록 전체를 도는 짝이 유일한 감시입니다.
   *
   * 아래 목록은 백엔드의 닫힌 분류 그대로입니다(`providers/openai-common.ts` 의 `OpenAiErrorCategory`,
   * `classifyOpenAiHttpError` 가 돌려주는 값). 이 목록을 여기서 다시 타이핑하는 것 자체가 두 번째 사본이라,
   * shared 가 이 유니온을 내보내면 표를 `Record<OpenAiErrorCategory, string>` 으로 바꿀 수 있고, 그러면
   * 이 짝 없이도 컴파일이 먼저 말합니다.
   */
  it("has its own sentence for every category the backend can actually send", () => {
    const backendCategories = [
      "authentication",
      "quota_or_permission",
      "rate_limit",
      "server",
      "network",
      "invalid_request",
      "safety_policy",
      "context_length_exceeded",
    ];
    // 그 단어를 적는 대신 fallback 을 모듈에게 직접 물어봅니다 — 문장을 다듬으면 짝이 조용히 느슬해지는 걸 막습니다.
    const fallback = toNarrationDisplayError(
      new NarrationApiError("NARRATION_PROVIDER_ERROR", "raw", { category: "not_a_real_category" }),
    ).message;

    for (const category of backendCategories) {
      const displayed = toNarrationDisplayError(
        new NarrationApiError("NARRATION_PROVIDER_ERROR", "raw backend detail", { category }),
      );
      expect(displayed.message, category).not.toBe(fallback);
      expect(displayed.message).not.toContain("raw");
    }
  });

  /**
   * 돈 쪽 이유로 따로 둠니다. 음성은 호출할 때마다 과금되므로, 계정/정책 문제처럼 또 눌러도 띄지 않는
   * 실패에 「잠시 후 다시 시도」를 권하는 것은 돈을 나가게 하는 조언입니다.
   */
  it("never tells someone to retry a narration failure that retrying cannot fix", () => {
    for (const category of ["quota_or_permission", "safety_policy", "authentication"]) {
      const displayed = toNarrationDisplayError(
        new NarrationApiError("NARRATION_PROVIDER_ERROR", "raw", { category }),
      );
      expect(displayed.message, category).not.toContain("잠시 후 다시 시도");
    }
  });

  it("keeps a scene's audio URL from being answered out of cache after a regeneration", () => {
    const first = narrationContentUrl("narr", 1, "v1");
    const second = narrationContentUrl("narr", 1, "v2");
    expect(first).not.toBe(second);
    expect(first).toContain("/projects/narr/narration/1/content");
  });
});
