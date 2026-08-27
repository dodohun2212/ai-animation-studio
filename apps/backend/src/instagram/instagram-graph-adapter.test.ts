import { describe, expect, it, vi } from "vitest";
import {
  InstagramAdapterError, createInstagramResumableContainer, uploadInstagramResumableVideo,
  getInstagramContainerStatus, publishInstagramContainer,
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
  it("posts the verified media request shape and returns the container ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "container-1" }));
    const result = await createInstagramResumableContainer("token", "17800000000000", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.containerId).toBe("container-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/17800000000000/media");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
    expect(JSON.parse(String(init.body))).toEqual({ media_type: "REELS", upload_type: "resumable" });
  });

  it("rejects an empty IG user ID without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(createInstagramResumableContainer("token", "  ", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never retries a 429 even when the caller asks for retries — container creation is not idempotent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-2" }));
    const sleep = vi.fn(noSleep);
    await expect(createInstagramResumableContainer("token", "id", { fetchImpl: fetchMock, sleep, maxRetries: 2 }))
      .rejects.toMatchObject({ category: "rate_limit" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("classifies error.code 190 as authentication using Graph API's own error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: "Error validating access token", code: 190 } }));
    await expect(createInstagramResumableContainer("token", "id", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "authentication", detail: "Error validating access token" });
  });

  it("classifies error.code 4 as rate_limit even on a non-429 status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "app request limit reached", code: 4 } }));
    await expect(createInstagramResumableContainer("token", "id", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "rate_limit" });
  });

  it("falls back to status-based classification when the body has no parseable error object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    await expect(createInstagramResumableContainer("token", "id", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "permission", detail: undefined });
  });

  it("rejects a response with no container ID as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    await expect(createInstagramResumableContainer("token", "id", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "unknown" });
  });

  it("is an instance of InstagramAdapterError with a Korean message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    try {
      await createInstagramResumableContainer("token", "id", { fetchImpl: fetchMock, sleep: noSleep });
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
