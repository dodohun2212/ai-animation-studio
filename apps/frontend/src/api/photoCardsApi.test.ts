import { describe, expect, it, vi, afterEach } from "vitest";

import { jsonResponse } from "./testUtils.js";
import { PhotoCardsApiError, createPhotoCard, toPhotoCardDisplayError } from "./photoCardsApi.js";

const request = { projectId: "quote_01", assetId: "ASSET-1", quote: "문장", clipDurationSeconds: 5, aspectRatio: "9:16" } as const;

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

  it("falls back safely for a code it does not know", () => {
    const displayed = toPhotoCardDisplayError(new PhotoCardsApiError("SOMETHING_NEW", "raw internal detail"));
    expect(displayed.code).toBe("CLIENT_UNKNOWN_ERROR");
    expect(displayed.message).not.toContain("raw internal detail");
  });
});
