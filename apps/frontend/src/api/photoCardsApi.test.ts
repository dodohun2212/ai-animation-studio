import { describe, expect, it, vi, afterEach } from "vitest";

import { jsonResponse } from "./testUtils.js";
import { PhotoCardsApiError, createPhotoCard, getPhotoCardSubtitleColors, toPhotoCardDisplayError } from "./photoCardsApi.js";

const request = { projectId: "quote_01", assetIds: ["ASSET-1"], quote: "문장", clipDurationSeconds: 5, aspectRatio: "9:16" } as const;

describe("photoCardsApi", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("posts to the contract's route and returns the created project", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project: { id: "quote_01" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await createPhotoCard({ ...request });
    expect(response.project.id).toBe("quote_01");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/photo-cards");
  });

  // The caller navigates using project.id. A body without it would send the screen nowhere and look like the
  // button did nothing, so it is refused as a malformed response rather than passed along.
  it("refuses a response with no project id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project: {} })));
    await expect(createPhotoCard({ ...request })).rejects.toBeInstanceOf(PhotoCardsApiError);
  });

  // Not a retry. The generic fallback would say "잠시 후 다시 시도해 주세요" for a file that will still be
  // unreadable on the next press, which is the one thing this code exists to avoid saying.
  it("does not offer a retry for an unusable picture", () => {
    const displayed = toPhotoCardDisplayError(new PhotoCardsApiError("PHOTO_CARD_ASSET_UNUSABLE", "raw"));
    expect(displayed.message).toContain("다른 그림");
    expect(displayed.message).not.toContain("잠시 후");
    expect(displayed.message).not.toContain("raw");
  });

  const COLORS = { body: "#ffe9b0", heading: "#ffc14d", outline: "#1a1206" };

  it("asks for the colours at the band the caller names, and returns the three", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { colors: COLORS }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await getPhotoCardSubtitleColors("quote_01", 0.6)).colors).toEqual(COLORS);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/projects/quote_01/photo-card/subtitle-colors?center=0.6");
  });

  /** `center` 없이 부르면 카드에 저장된 값 — 주소에 빈 `center=` 가 붙으면 서버가 범위 밖으로 거절합니다. */
  it("leaves the band out entirely when the caller does not name one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { colors: null }));
    vi.stubGlobal("fetch", fetchMock);

    await getPhotoCardSubtitleColors("quote_01");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/projects/quote_01/photo-card/subtitle-colors");
  });

  /**
   * 🔴 `colors: null` 은 답이고, 키가 아예 없는 응답은 고장입니다. 둘을 같은 `null` 로 뭉개면 망가진 조회가
   * 「그림을 못 읽었나 보다」로 조용히 위장하고, 미리보기는 그걸 병합의 답이라며 흰 글씨를 앉혀 둡니다.
   */
  it("keeps 'the picture could not be read' apart from 'the answer was not an answer'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { colors: null })));
    expect((await getPhotoCardSubtitleColors("quote_01")).colors).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));
    await expect(getPhotoCardSubtitleColors("quote_01")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  /**
   * 🔴 이 세 문자열은 곧장 `color` 와 `text-shadow` 로 들어갑니다. `#RRGGBB` 가 아닌 것을 CSS 에 넘기면
   * 조용히 무시되고, 흰 글씨가 병합의 답인 척 앉아 있게 됩니다 — 그러느니 형식이 틀린 답으로 거절합니다.
   */
  it.each([
    [{ ...COLORS, body: "red" }],
    [{ ...COLORS, heading: "#fff" }],
    [{ ...COLORS, outline: "javascript:alert(1)" }],
    [{ body: COLORS.body, heading: COLORS.heading }],
  ])("refuses colours that are not #RRGGBB rather than handing them to CSS", async (colors) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { colors })));
    await expect(getPhotoCardSubtitleColors("quote_01")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  /**
   * 🔴 The running server answers in UPPERCASE (`#EBF2F4`), and every fixture above is lowercase. The guard
   * spells the range `a-fA-F`, so it happens to be right — but nothing above says so, and a tightening to
   * `[0-9a-f]{6}` would leave all thirteen pairs green while refusing every colour the real backend sends.
   * Measured against the live lookup, not assumed (CLI Round 893).
   */
  it("takes the uppercase hex the server actually sends", async () => {
    const upper = { body: "#EBF2F4", heading: "#B3DAE5", outline: "#0B191E" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { colors: upper })));
    await expect(getPhotoCardSubtitleColors("quote_01")).resolves.toEqual({ colors: upper });
  });

  it("maps a refused band to the safe message, never the backend's own words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "INVALID_REQUEST", message: "raw backend detail C:/Users/someone" })));

    let caught: unknown;
    try { await getPhotoCardSubtitleColors("quote_01", 0.99); } catch (error) { caught = error; }
    const displayed = toPhotoCardDisplayError(caught);
    expect(displayed.code).toBe("INVALID_REQUEST");
    expect(displayed.message).not.toContain("raw backend detail");
    expect(displayed.message).not.toContain("C:/Users");
  });

  it("reports a 5xx with no error shape as the server not answering", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));
    await expect(getPhotoCardSubtitleColors("quote_01")).rejects.toMatchObject({ code: "CLIENT_SERVER_UNAVAILABLE" });
  });

  it("maps a network failure to a safe network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(getPhotoCardSubtitleColors("quote_01")).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });
  });

  it("falls back safely for a code it does not know", () => {
    const displayed = toPhotoCardDisplayError(new PhotoCardsApiError("SOMETHING_NEW", "raw internal detail"));
    expect(displayed.code).toBe("CLIENT_UNKNOWN_ERROR");
    expect(displayed.message).not.toContain("raw internal detail");
  });
});
