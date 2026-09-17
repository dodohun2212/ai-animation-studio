import { afterEach, describe, expect, it, vi } from "vitest";
import { API_ROUTES, type NewsArticleInput } from "@ai-animation-studio/shared";

import { NEWS_CHECK_SCOPE_NOTICE, createNewsSummary, toNewsDisplayError } from "./newsApi.js";

afterEach(() => { vi.unstubAllGlobals(); });

function article(): NewsArticleInput {
  return {
    title: "시청 앞 도로 통제",
    body: "9월 14일 오전 9시부터 시청 앞 도로가 통제된다. 관계자는 「우회로를 안내하겠다」고 말했다. 통제는 4시간 동안 이어진다.",
    publisher: "예시일보",
    publishedAt: "2026-09-14T00:00:00.000Z",
    sourceUrl: "https://example.com/a/1",
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function claim(text: string, found: boolean, kind: "number" | "date" | "quote" = "number") {
  return { kind, text, found };
}

describe("newsApi", () => {
  it("sends the article whole, body included, to the contract's route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      summary: "시청 앞 도로가 4시간 통제된다.",
      check: { claims: [claim("4시간", true)], missing: [] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await createNewsSummary(article());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(API_ROUTES.newsSummaries);
    expect(init.method).toBe("POST");
    // 🔴 The body is what the check searches. A client that trimmed it to save bytes would make every summary
    // uncheckable while every test about the check still passed.
    expect(JSON.parse(String(init.body)).article.body).toBe(article().body);
  });

  /**
   * 🔴 The refusal is the feature. It has to arrive with the list of spans that were not in the article —
   * a refusal that only says "no" leaves the person with nothing to compare and no reason to believe it.
   */
  it("keeps the refused claims so the screen can show what was not in the article", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, {
      code: "NEWS_SUMMARY_UNSUPPORTED_CLAIM",
      message: "raw backend detail C:/Users/someone",
      details: { check: { claims: [claim("4시간", true), claim("1만 2천 명", false)], missing: [claim("1만 2천 명", false)] } },
    })));

    let caught: unknown;
    try { await createNewsSummary(article()); } catch (error) { caught = error; }

    expect((caught as { check?: { missing: { text: string }[] } }).check?.missing.map((one) => one.text)).toEqual(["1만 2천 명"]);
    const displayed = toNewsDisplayError(caught);
    expect(displayed.code).toBe("NEWS_SUMMARY_UNSUPPORTED_CLAIM");
    expect(displayed.message).not.toContain("raw backend detail");
    expect(displayed.message).not.toContain("C:/Users");
    // 「다시 시도」 is wrong here: the same article and model invent the same thing, and the retry is paid for.
    expect(displayed.message).not.toContain("잠시 후 다시");
  });

  /**
   * 🔴 The success path's own version of the same lie. The screen blocks on `missing` and the person reads
   * `claims`; a response where the two disagree shows a clean summary over a recorded invention — the refusal
   * arriving as an approval. Refused as malformed rather than believed.
   */
  it("refuses a success whose missing list disagrees with its claims", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      summary: "시청 앞 도로가 통제된다.",
      check: { claims: [claim("4시간", true), claim("1만 2천 명", false)], missing: [] },
    })));

    await expect(createNewsSummary(article())).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  /** The cap is in the contract, so a summary over it is a server that ignored its own rule, not a long answer. */
  it("refuses a summary longer than the contract's cap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      summary: "가".repeat(401),
      check: { claims: [], missing: [] },
    })));

    await expect(createNewsSummary(article())).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("reports a 5xx with no error shape as the server not answering", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));
    await expect(createNewsSummary(article())).rejects.toMatchObject({ code: "CLIENT_SERVER_UNAVAILABLE" });
  });

  it("maps a network failure to a safe network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(createNewsSummary(article())).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });
  });

  /**
   * The notice says which three kinds were compared. Without it a green check reads as "this summary is true",
   * which is a guarantee nothing here gives — so the words live in one exported place rather than in each screen.
   */
  it("states what the check did and did not look at", () => {
    expect(NEWS_CHECK_SCOPE_NOTICE).toContain("숫자");
    expect(NEWS_CHECK_SCOPE_NOTICE).toContain("날짜");
    expect(NEWS_CHECK_SCOPE_NOTICE).toContain("인용");
    expect(NEWS_CHECK_SCOPE_NOTICE).toContain("뜻이 맞는지는 대조하지 않습니다");
  });
});
