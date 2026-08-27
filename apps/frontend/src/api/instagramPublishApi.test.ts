import { afterEach, describe, expect, it, vi } from "vitest";

import { InstagramPublishApiError, publishToInstagram, toInstagramPublishDisplayError } from "./instagramPublishApi.js";
import { jsonResponse, makeProject, nonJsonResponse } from "./testUtils.js";

const OK = { mediaId: "media_1", publishedAt: "2026-08-27T10:00:00.000Z", project: makeProject({ id: "p1" }) };

describe("instagramPublishApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // `approved: true` is never defaulted anywhere in the chain, so no code path can reach a publish without a
  // person having said yes to a panel that named the account.
  it("sends approved, the caption, and the account the caller named", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, OK));
    vi.stubGlobal("fetch", fetchMock);

    await publishToInstagram("p 1", "본문\n\n#태그", "17841400000000000");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/p%201/instagram/publish");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      approved: true,
      caption: "본문\n\n#태그",
      igUserId: "17841400000000000",
    });
  });

  it("returns the project the server recorded the post on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, OK)));
    const response = await publishToInstagram("p1", "본문", "1");
    expect(response.mediaId).toBe("media_1");
  });

  // A response that says a post happened but cannot say which one, or on what project, is not something to
  // render as success — the screen switches to "already published" off this answer.
  it("rejects a success response missing what it would have to display", async () => {
    for (const bad of [
      { publishedAt: OK.publishedAt, project: OK.project },
      { mediaId: "m", project: OK.project },
      { mediaId: "m", publishedAt: OK.publishedAt },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, bad)));
      await expect(publishToInstagram("p1", "본문", "1")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
    }
  });

  // These two say opposite things about the world, and this is the error path of the one action nobody can undo.
  // Blurring them would tell the already-published case to do the single thing it must not.
  it("tells a failed publish it is safe to retry, and never tells an already-published one that", () => {
    const failed = toInstagramPublishDisplayError(errorFrom("INSTAGRAM_PUBLISH_FAILED"));
    expect(failed.message).toContain("아무것도 게시되지 않았");
    expect(failed.message).toContain("다시 시도해도 됩니다");

    const already = toInstagramPublishDisplayError(errorFrom("INSTAGRAM_ALREADY_PUBLISHED"));
    expect(already.message).toContain("이미 게시");
    expect(already.message).not.toContain("다시 시도");
  });

  it("gives every backend code its own message instead of the generic fallback", async () => {
    const generic = toInstagramPublishDisplayError(new Error("unmapped"));
    const codes = [
      "INVALID_REQUEST",
      "INSTAGRAM_ALREADY_PUBLISHED",
      "INSTAGRAM_VIDEO_UNAVAILABLE",
      "INSTAGRAM_NOT_CONNECTED",
      "INSTAGRAM_TARGET_NOT_FOUND",
      "INSTAGRAM_PUBLISH_FAILED",
    ] as const;

    for (const code of codes) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code, message: `${code} raw backend detail` })));
      const caught = await publishToInstagram("p1", "본문", "1").catch((error: unknown) => error);
      const display = toInstagramPublishDisplayError(caught);

      expect(display.code).toBe(code);
      expect(display.message).not.toBe(generic.message);
      // Meta's own wording and any filesystem path stay out of the screen — this is the loudest failure surface
      // in the app and the easiest place for a raw detail to end up in front of someone.
      expect(display.message).not.toContain("raw backend detail");
    }
  });

  it("falls back to a generic message for a code it does not know", () => {
    expect(toInstagramPublishDisplayError(errorFrom("SOMETHING_NEW")).code).toBe("CLIENT_UNKNOWN_ERROR");
  });

  it("reports a network failure as its own code rather than as a server answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const caught = await publishToInstagram("p1", "본문", "1").catch((error: unknown) => error);
    expect(toInstagramPublishDisplayError(caught).code).toBe("CLIENT_NETWORK_ERROR");
  });

  // An error body that is not JSON must not be shown as if it were a reason — "the server said something we
  // could not read" is a different fact from "the server refused for reason X".
  it("treats an unreadable error body as malformed rather than inventing a reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(502)));
    const caught = await publishToInstagram("p1", "본문", "1").catch((error: unknown) => error);
    expect(toInstagramPublishDisplayError(caught).code).toBe("CLIENT_MALFORMED_RESPONSE");
  });
});

/**
 * The real error class, not a look-alike: the mapper answers by `instanceof`, so a hand-rolled shape would fall
 * through to the generic message and the assertions below would be passing on nothing.
 */
function errorFrom(code: string): InstagramPublishApiError {
  return new InstagramPublishApiError(code, "raw backend detail");
}
