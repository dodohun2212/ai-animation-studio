import { afterEach, describe, expect, it, vi } from "vitest";

import { createFlowerCard, toFlowerCardDisplayError, type FlowerCardsApiError } from "./flowerCardsApi.js";
import { jsonResponse, makeProject, nonJsonResponse } from "./testUtils.js";

const request = {
  projectId: "꽃말_장미",
  flowerName: "장미",
  meaning: "열정",
  scenes: [
    { description: "씨앗이 흙에 놓이고 흙이 덮인다", caption: "모든 꽃은 흙 속에서 시작한다." },
    { description: "줄기가 자라 봉오리가 열린다", caption: "장미의 꽃말은 열정이다." },
  ],
  clipDurationSeconds: 10 as const,
  aspectRatio: "9:16" as const,
};
const ok = { project: makeProject({ id: "꽃말_장미" }), review: { scriptRevision: 1, items: [] } };

describe("flowerCardsApi", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("posts the whole request and returns the project with its opened mapping review", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, ok));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createFlowerCard(request)).resolves.toMatchObject({ project: { id: "꽃말_장미" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/flower-cards");
    expect(init.method).toBe("POST");
    // Sent whole rather than field by field: a scene silently dropped here would be a reel one beat short.
    expect(JSON.parse(String(init.body))).toEqual(request);
  });

  /**
   * 🔴 A response with a project and no review is refused rather than accepted.
   *
   * Approving an Asset Mapping review checks the script fingerprint against a baseline, and a project whose
   * review was never opened reads back `""` — approval then refuses with `no_baseline`. Taking such a response
   * would send someone to a mapping screen they cannot leave, with a button that looked like it worked.
   */
  it("refuses a response that carries no mapping review", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project: makeProject({ id: "꽃말_장미" }) })));

    await expect(createFlowerCard(request)).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("never surfaces the backend's raw message — only a fixed sentence per code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse(409, { code: "PROJECT_ALREADY_EXISTS", message: "C:\\Users\\secret\\projects\\꽃말_장미 exists" }),
    ));

    const caught = (await createFlowerCard(request).catch((error: unknown) => error)) as FlowerCardsApiError;
    const display = toFlowerCardDisplayError(caught);
    expect(display.message).toBe("같은 이름이 이미 있습니다. 다른 이름을 써 주세요.");
    expect(JSON.stringify(display)).not.toContain("secret");
    expect(JSON.stringify(display)).not.toContain("C:\\");
  });

  it("maps a network failure to a safe network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const caught = await createFlowerCard(request).catch((error: unknown) => error);
    expect(toFlowerCardDisplayError(caught).code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("maps a non-JSON error body to the safe malformed-response error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(400)));

    await expect(createFlowerCard(request)).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  /**
   * The status is what separates the two. A 4xx whose body cannot be read is something answering badly; a 5xx
   * that carries no error shape at all is nothing answering — the backend is down, restarting, or something in
   * front of it replied.
   */
  it("reports a 5xx with no error shape as the server not answering, not as a bad answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(500)));

    const caught = await createFlowerCard(request).catch((error: unknown) => error);
    const display = toFlowerCardDisplayError(caught);
    expect(display.code).toBe("CLIENT_SERVER_UNAVAILABLE");
    expect(display.message).toContain("서버가 응답하지 않습니다");
  });

  it("falls back to a fixed unknown-error message for an unmapped code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "SOMETHING_NEW", message: "raw" })));

    const caught = await createFlowerCard(request).catch((error: unknown) => error);
    expect(toFlowerCardDisplayError(caught).code).toBe("CLIENT_UNKNOWN_ERROR");
  });
});
