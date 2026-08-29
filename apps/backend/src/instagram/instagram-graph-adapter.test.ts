import { describe, expect, it, vi } from "vitest";
import {
  InstagramAdapterError, createInstagramResumableContainer, uploadInstagramResumableVideo,
  getInstagramContainerStatus, listInstagramPublishTargets, publishInstagramContainer,
} from "./instagram-graph-adapter.js";

const VIDEO_BYTES = Buffer.from("fake mp4 bytes");
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}
const noSleep = async () => {};

describe("createInstagramResumableContainer", () => {
  /**
   * The caption rides here or nowhere. `media_publish` takes only the creation id, so a caption missing from
   * this body is a caption the finished Reel will never have — which is how one went out empty, without the
   * licence credit and AI disclosure the screen said were in it. This assertion is exact on purpose, but it
   * used to be exact around a body with no caption in it, which is what let the omission stand.
   */
  it("posts the verified media request shape, caption included, and returns the container ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "container-1" }));
    const result = await createInstagramResumableContainer("token", "17800000000000", "오늘의 영상 #ai", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.containerId).toBe("container-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/17800000000000/media");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
    expect(JSON.parse(String(init.body))).toEqual({ media_type: "REELS", upload_type: "resumable", caption: "오늘의 영상 #ai" });
  });

  it("omits the caption field entirely when there is no caption, rather than sending an empty one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "container-1" }));
    await createInstagramResumableContainer("token", "17800000000000", "", { fetchImpl: fetchMock, sleep: noSleep });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ media_type: "REELS", upload_type: "resumable" });
  });

  it("rejects an empty IG user ID without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(createInstagramResumableContainer("token", "  ", "caption", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never retries a 429 even when the caller asks for retries — container creation is not idempotent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-2" }));
    const sleep = vi.fn(noSleep);
    await expect(createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep, maxRetries: 2 }))
      .rejects.toMatchObject({ category: "rate_limit" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("classifies error.code 190 as authentication using Graph API's own error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: "Error validating access token", code: 190 } }));
    await expect(createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "authentication", detail: "Error validating access token" });
  });

  it("classifies error.code 4 as rate_limit even on a non-429 status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "app request limit reached", code: 4 } }));
    await expect(createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "rate_limit" });
  });

  it("does not call error.code 1 a server problem — Meta documents it as two different situations", async () => {
    // Code 1 is "possibly downtime, and if it recurs check you are requesting an existing API". Reporting one of
    // those as fact is how a login refused over a credential was described as a Meta outage, which told the
    // person to wait for something that was never going to pass on its own.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "Error validating client secret.", code: 1 } }));
    await expect(createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "unknown" });
  });

  it("still calls error.code 2 a server problem — that one Meta documents as downtime alone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "API Service", code: 2 } }));
    await expect(createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "server" });
  });

  it("carries the numbers the category was derived from", async () => {
    // Without these a category is an assertion with nothing to check it against, which is exactly the position
    // the first real login failure left us in.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "nope", code: 100, error_subcode: 33 } }));
    await expect(createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ diagnostics: { status: 400, graphCode: 100, graphSubcode: 33 } });
  });

  it("carries the status even when the body cannot be read at all", async () => {
    // The unreadable-body branch is one of the answers to "which branch classified this", so it has to be
    // distinguishable from the others rather than reported as nothing.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 502,
      json: async () => { throw new Error("not json"); },
      headers: { get: () => null },
    } as unknown as Response);
    const caught = await createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep: noSleep })
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(InstagramAdapterError);
    expect((caught as InstagramAdapterError).diagnostics).toEqual({ status: 502 });
    expect((caught as InstagramAdapterError).detail).toBeUndefined();
  });

  it("falls back to status-based classification when the body has no parseable error object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    await expect(createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "permission", detail: undefined });
  });

  it("rejects a response with no container ID as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    await expect(createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "unknown" });
  });

  it("is an instance of InstagramAdapterError with a Korean message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    try {
      await createInstagramResumableContainer("token", "id", "caption", { fetchImpl: fetchMock, sleep: noSleep });
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InstagramAdapterError);
      expect((error as InstagramAdapterError).message).toContain("인증");
    }
  });
});

describe("uploadInstagramResumableVideo", () => {
  it("posts the whole video with the documented rupload headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, message: "Upload successful." }));
    await uploadInstagramResumableVideo("token", "container-1", VIDEO_BYTES, { fetchImpl: fetchMock, sleep: noSleep });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://rupload.facebook.com/ig-api-upload/v26.0/container-1");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("OAuth token");
    expect(headers.offset).toBe("0");
    expect(headers.file_size).toBe(String(VIDEO_BYTES.length));
    expect(init.body).toBe(VIDEO_BYTES);
  });

  it("rejects an empty video buffer without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(uploadInstagramResumableVideo("token", "container-1", Buffer.alloc(0), { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never retries on an ambiguous network failure — a lost response does not mean Meta never received the bytes", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(jsonResponse(200, { success: true }));
    await expect(uploadInstagramResumableVideo("token", "container-1", VIDEO_BYTES, { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 2 }))
      .rejects.toMatchObject({ category: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response that does not explicitly say success as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: false }));
    await expect(uploadInstagramResumableVideo("token", "container-1", VIDEO_BYTES, { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "unknown" });
  });
});

describe("getInstagramContainerStatus", () => {
  it("gets the container status by ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "container-1", status_code: "IN_PROGRESS" }));
    const result = await getInstagramContainerStatus("token", "container-1", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.statusCode).toBe("IN_PROGRESS");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/container-1?fields=status_code");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
  });

  it.each(["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"] as const)("accepts the documented status_code %s", async (statusCode) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status_code: statusCode }));
    const result = await getInstagramContainerStatus("token", "container-1", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.statusCode).toBe(statusCode);
  });

  it("rejects an unrecognized status_code as unknown, rather than passing it through", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status_code: "SOMETHING_NEW" }));
    await expect(getInstagramContainerStatus("token", "container-1", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "unknown" });
  });

  it("does retry a transient failure — status checks are read-only and safe to repeat", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }));
    const result = await getInstagramContainerStatus("token", "container-1", { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 2 });
    expect(result.statusCode).toBe("FINISHED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("listInstagramPublishTargets", () => {
  it("walks the user's pages and returns each connected account with its handle", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [
        { name: "이배드 스튜디오", instagram_business_account: { id: "178000001", username: "ibad_studio" } },
        { name: "두 번째 페이지", instagram_business_account: { id: "178000002", username: "second_one" } },
      ],
    }));
    const targets = await listInstagramPublishTargets("token", { fetchImpl: fetchMock, sleep: noSleep });
    expect(targets).toEqual([
      { igUserId: "178000001", username: "ibad_studio", pageName: "이배드 스튜디오" },
      { igUserId: "178000002", username: "second_one", pageName: "두 번째 페이지" },
    ]);
    const url = new URL(String((fetchMock.mock.calls[0] as [string, RequestInit])[0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://graph.facebook.com/v26.0/me/accounts");
    expect(url.searchParams.get("fields")).toBe("name,instagram_business_account{id,username}");
  });

  it("skips a page that has no Instagram account connected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [{ name: "연결 안 된 페이지" }, { name: "연결됨", instagram_business_account: { id: "178000003", username: "connected" } }],
    }));
    await expect(listInstagramPublishTargets("token", { fetchImpl: fetchMock, sleep: noSleep }))
      .resolves.toEqual([{ igUserId: "178000003", username: "connected", pageName: "연결됨" }]);
  });

  it("reads the handle separately when the nested traversal does not return it", async () => {
    // The nested-field syntax is not in Meta's documented field list for this edge, so an id arriving without a
    // username is handled rather than assumed impossible — a numeric id cannot name the destination account.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ name: "페이지", instagram_business_account: { id: "178000004" } }] }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "178000004", username: "recovered_handle" }));
    const targets = await listInstagramPublishTargets("token", { fetchImpl: fetchMock, sleep: noSleep });
    expect(targets).toEqual([{ igUserId: "178000004", username: "recovered_handle", pageName: "페이지" }]);
    const second = new URL(String((fetchMock.mock.calls[1] as [string, RequestInit])[0]));
    expect(`${second.origin}${second.pathname}`).toBe("https://graph.facebook.com/v26.0/178000004");
    expect(second.searchParams.get("fields")).toBe("username");
  });

  it("still offers an account whose handle cannot be read at all, rather than dropping it from the list", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ name: "페이지", instagram_business_account: { id: "178000005" } }] }))
      .mockResolvedValueOnce(jsonResponse(500, {}));
    await expect(listInstagramPublishTargets("token", { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 0 }))
      .resolves.toEqual([{ igUserId: "178000005", username: "178000005", pageName: "페이지" }]);
  });

  it("returns an empty list for a user with no pages, and surfaces an expired token as authentication", async () => {
    const empty = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    await expect(listInstagramPublishTargets("token", { fetchImpl: empty, sleep: noSleep })).resolves.toEqual([]);

    const expired = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "Session has expired", code: 190 } }));
    await expect(listInstagramPublishTargets("token", { fetchImpl: expired, sleep: noSleep }))
      .rejects.toMatchObject({ category: "authentication" });
  });
});

describe("publishInstagramContainer", () => {
  it("posts the verified media_publish request shape and returns the media ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "media-1" }));
    const result = await publishInstagramContainer("token", "17800000000000", "container-1", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.mediaId).toBe("media-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/17800000000000/media_publish");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ creation_id: "container-1" });
  });

  it("never retries a 500 even when the caller asks for retries — publishing is irreversible and not idempotent", async () => {
    // The exact discipline runway-video-adapter.ts's createRunwayImageToVideoTask() applies to paid task
    // creation — here the stakes are a real, public, duplicate post instead of a duplicate charge.
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(500, {})).mockResolvedValueOnce(jsonResponse(200, { id: "media-2" }));
    await expect(publishInstagramContainer("token", "id", "container-1", { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 2 }))
      .rejects.toMatchObject({ category: "server" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries an ambiguous network failure, even when the caller asks for retries", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(jsonResponse(200, { id: "media-3" }));
    await expect(publishInstagramContainer("token", "id", "container-1", { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 2 }))
      .rejects.toMatchObject({ category: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with no media ID as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    await expect(publishInstagramContainer("token", "id", "container-1", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "unknown" });
  });
});
