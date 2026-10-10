import { afterEach, describe, expect, it, vi } from "vitest";

import { MemeTrendsApiError, analyzeMemeVideo, dailyCallsFromError, getMemeTrendWorkspace, getMemeTrends, refreshMemeTrends, saveMemeObservationCards, toMemeTrendDisplayError } from "./memeTrendsApi.js";
import { jsonResponse, nonJsonResponse } from "./testUtils.js";

const EMPTY = { source: "youtube", regionCode: "KR", collectedAt: null, trends: [] };

describe("memeTrendsApi", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads with a plain GET and refreshes with a POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, EMPTY));
    vi.stubGlobal("fetch", fetchMock);
    await getMemeTrends();
    await refreshMemeTrends();
    expect(fetchMock.mock.calls[0]).toEqual(["/trends/memes", undefined]);
    expect(fetchMock.mock.calls[1]).toEqual(["/trends/memes/refresh", { method: "POST" }]);
  });

  /** 코드마다 다음에 할 일이 다릅니다 — 넷이 한 문장으로 합쳐지지 않는지. */
  it("gives each backend refusal its own sentence and never the server's raw text", async () => {
    const sentences = new Set<string>();
    for (const code of ["MEME_TREND_KEY_MISSING", "MEME_TREND_QUOTA_EXCEEDED", "MEME_TREND_SOURCE_FAILED", "MEME_TREND_STORE_UNREADABLE"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code, message: "raw C:/secret" })));
      const caught = await refreshMemeTrends().catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(MemeTrendsApiError);
      const shown = toMemeTrendDisplayError(caught);
      expect(shown.code).toBe(code);
      expect(shown.message).not.toContain("raw");
      sentences.add(shown.message);
    }
    expect(sentences.size).toBe(4);
  });

  it("tells a server that never answered apart from a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(502)));
    expect(toMemeTrendDisplayError(await getMemeTrends().catch((error: unknown) => error)).code).toBe("CLIENT_SERVER_UNAVAILABLE");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(toMemeTrendDisplayError(await getMemeTrends().catch((error: unknown) => error)).code).toBe("CLIENT_NETWORK_ERROR");
  });

  /** CLI Round 1280: 작업 공간 읽기·분석·저장 — 같은 후보 id 를 인코딩해 세 길로. */
  it("reads, analyses and saves a candidate's workspace on its own routes", async () => {
    const workspace = { trendId: "니코 니", analyses: [], cards: [], cardsSavedAt: null, dailyCalls: { used: 0, limit: 3 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, workspace));
    vi.stubGlobal("fetch", fetchMock);
    await getMemeTrendWorkspace("니코 니");
    await analyzeMemeVideo("니코 니", { sourceVideoId: "v1" });
    await saveMemeObservationCards("니코 니", { cards: [], expectedCardsSavedAt: null });
    const encoded = encodeURIComponent("니코 니");
    expect(fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(url)}`)).toEqual([
      `GET /trends/memes/${encoded}/workspace`,
      `POST /trends/memes/${encoded}/analysis`,
      `PUT /trends/memes/${encoded}/cards`,
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body))).toEqual({ sourceVideoId: "v1" });
  });

  it("refuses a malformed workspace and reads the new count off a failed analysis", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { trendId: "x", analyses: [], cards: "nope", cardsSavedAt: null, dailyCalls: null })));
    expect(toMemeTrendDisplayError(await getMemeTrendWorkspace("x").catch((error: unknown) => error)).code).toBe("CLIENT_MALFORMED_RESPONSE");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(502, { code: "MEME_ANALYSIS_FAILED", message: "raw", details: { dailyCalls: { used: 2, limit: 3 } } })));
    const caught = await analyzeMemeVideo("x", { sourceVideoId: "v" }).catch((error: unknown) => error);
    expect(dailyCallsFromError(caught)).toEqual({ used: 2, limit: 3 });
    expect(dailyCallsFromError(new MemeTrendsApiError("MEME_ANALYSIS_FAILED", "", { dailyCalls: { used: -1, limit: 3 } }))).toBeNull();
  });
});
