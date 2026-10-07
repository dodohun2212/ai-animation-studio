import { afterEach, describe, expect, it, vi } from "vitest";

import { MemeTrendsApiError, getMemeTrends, refreshMemeTrends, toMemeTrendDisplayError } from "./memeTrendsApi.js";
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
});
