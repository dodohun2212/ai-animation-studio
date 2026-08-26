import { describe, expect, it, vi } from "vitest";
import {
  RunwayAdapterError, createRunwayImageToVideoTask, downloadRunwayOutput, getRunwayTask,
} from "./runway-video-adapter.js";

const IMAGE_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    arrayBuffer: async () => (body as { __bytes?: Buffer }).__bytes ?? new ArrayBuffer(0),
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}
const noSleep = async () => {};

describe("createRunwayImageToVideoTask", () => {
  it("posts the verified image_to_video request shape and returns the task ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1", estimatedCost: { credits: 25 } }));
    const result = await createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "a hero walks forward", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.taskId).toBe("task-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.dev.runwayml.com/v1/image_to_video");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
    expect(headers["x-runway-version"]).toBe("2024-11-06");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "gen4_turbo", promptText: "a hero walks forward", ratio: "720:1280", duration: 5 });
    expect(body.promptImage).toBe(`data:image/png;base64,${IMAGE_BYTES.toString("base64")}`);
  });

  it("uses caller-supplied model/ratio/duration instead of the defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1" }));
    await createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "prompt", { model: "gen4.5", ratio: "1280:720", durationSeconds: 10, fetchImpl: fetchMock, sleep: noSleep });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: "gen4.5", ratio: "1280:720", duration: 10 });
  });

  it("rejects an empty prompt without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "   ", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a prompt exceeding 1000 UTF-16 code units without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "x".repeat(1001), { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an image over the 5MB data-URI limit without calling fetch", async () => {
    const fetchMock = vi.fn();
    const huge = Buffer.alloc(5 * 1024 * 1024 + 1);
    await expect(createRunwayImageToVideoTask("secret", huge, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an image whose base64-encoded text exceeds 5MB even though its raw bytes do not", async () => {
    // base64 inflates size by ~4/3 — 3.75MB of raw bytes already encodes to just over 5MB of base64 text, the
    // actual thing Runway's data-URI limit applies to. The old check compared raw bytes and let this through
    // locally, only for Runway to reject it remotely after a real request went out.
    const fetchMock = vi.fn();
    const underRawLimitOverBase64Limit = Buffer.alloc(3_932_200);
    expect(underRawLimitOverBase64Limit.length).toBeLessThan(5 * 1024 * 1024);
    expect(underRawLimitOverBase64Limit.toString("base64").length).toBeGreaterThan(5 * 1024 * 1024);
    await expect(createRunwayImageToVideoTask("secret", underRawLimitOverBase64Limit, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies a 401 as authentication and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: "bad key" } }));
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "authentication" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("carries Runway's own rejection text as detail, in every response shape it might arrive in, without changing the safe Korean message", async () => {
    const shapes: Array<[unknown, string]> = [
      [{ error: { message: "bad key" } }, "bad key"],
      [{ error: "prompt rejected" }, "prompt rejected"],
      [{ message: "top-level message" }, "top-level message"],
    ];
    for (const [body, expectedDetail] of shapes) {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, body));
      try {
        await createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep });
        throw new Error("expected to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(RunwayAdapterError);
        expect((error as RunwayAdapterError).detail).toBe(expectedDetail);
        expect((error as RunwayAdapterError).message).toContain("인증"); // the safe Korean text, untouched by detail
      }
    }
  });

  it("reclassifies a credit-shortage 400 as quota_or_permission instead of invalid_request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: "You do not have enough credits to run this task." }));
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "quota_or_permission", detail: "You do not have enough credits to run this task." });
  });

  it("leaves a 400 with no credit/quota wording classified as invalid_request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: "prompt is malformed" }));
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
  });

  it("leaves detail undefined rather than throwing when the rejected response has no readable message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { code: "bad_request" })); // no error/message field
    try {
      await createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep });
      throw new Error("expected to throw");
    } catch (error) {
      expect((error as RunwayAdapterError).detail).toBeUndefined();
    }
  });

  it("classifies a 403 as permission and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "permission" });
  });

  it("never retries a 429 even when the caller asks for retries — task creation is not idempotent", async () => {
    // A real user's Runway dashboard showed exactly this call retried and duplicated: two POSTs per scene, one
    // task ever polled, both billed (`.claude-bridge` Round 145). maxRetries here must have no effect.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "task-2" }));
    const sleep = vi.fn(noSleep);
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep, maxRetries: 2 }))
      .rejects.toMatchObject({ category: "rate_limit" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never retries a 500 server error, even when the caller asks for retries", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(500, {})).mockResolvedValueOnce(jsonResponse(200, { id: "task-3" }));
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 2 }))
      .rejects.toMatchObject({ category: "server" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a 400/404/409/422 as invalid_request and never retries", async () => {
    for (const status of [400, 404, 409, 422]) {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, {}));
      await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep }))
        .rejects.toMatchObject({ category: "invalid_request" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("never retries a network-level fetch rejection, even when the caller asks for retries — a lost response does not mean Runway never received the request", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(jsonResponse(200, { id: "task-4" }));
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 2 }))
      .rejects.toMatchObject({ category: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with no task ID as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    await expect(createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "unknown" });
  });

  it("is an instance of RunwayAdapterError with a Korean message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    try {
      await createRunwayImageToVideoTask("secret", IMAGE_BYTES, "image/png", "p", { fetchImpl: fetchMock, sleep: noSleep });
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunwayAdapterError);
      expect((error as RunwayAdapterError).message).toContain("인증");
    }
  });
});

describe("getRunwayTask", () => {
  it("gets the task by ID and returns RUNNING with progress", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1", status: "RUNNING", progress: 0.4, createdAt: "2026-01-01T00:00:00Z" }));
    const task = await getRunwayTask("secret", "task-1", { fetchImpl: fetchMock, sleep: noSleep });
    expect(task).toMatchObject({ taskId: "task-1", status: "RUNNING", progress: 0.4, terminal: false, outputUrls: [] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.dev.runwayml.com/v1/tasks/task-1");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-runway-version"]).toBe("2024-11-06");
  });

  it("returns SUCCEEDED with output URLs and marks it terminal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1", status: "SUCCEEDED", output: ["https://cdn.runwayml.com/out.mp4"] }));
    const task = await getRunwayTask("secret", "task-1", { fetchImpl: fetchMock, sleep: noSleep });
    expect(task).toMatchObject({ status: "SUCCEEDED", outputUrls: ["https://cdn.runwayml.com/out.mp4"], terminal: true });
  });

  it("returns FAILED with a combined failure message and code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1", status: "FAILED", failure: "content flagged", failureCode: "SAFETY.INPUT.FLAGGED" }));
    const task = await getRunwayTask("secret", "task-1", { fetchImpl: fetchMock, sleep: noSleep });
    expect(task.failure).toBe("content flagged (Runway code: SAFETY.INPUT.FLAGGED)");
    expect(task.terminal).toBe(true);
  });

  it("rejects an empty task_id without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(getRunwayTask("secret", "  ", { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a response with no status as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "task-1" }));
    await expect(getRunwayTask("secret", "task-1", { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "unknown" });
  });
});

describe("downloadRunwayOutput", () => {
  it("downloads and returns the raw bytes from an ephemeral output URL without a Runway auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => IMAGE_BYTES.buffer.slice(IMAGE_BYTES.byteOffset, IMAGE_BYTES.byteOffset + IMAGE_BYTES.byteLength), headers: { get: () => null } } as unknown as Response);
    const bytes = await downloadRunwayOutput("https://cdn.runwayml.com/out.mp4", { fetchImpl: fetchMock, sleep: noSleep });
    expect(bytes).toEqual(IMAGE_BYTES);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cdn.runwayml.com/out.mp4");
    expect(init.headers).toBeUndefined();
  });

  it("rejects a non-http(s) URL without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(downloadRunwayOutput("ftp://example.com/file", { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty download as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } } as unknown as Response);
    await expect(downloadRunwayOutput("https://cdn.runwayml.com/out.mp4", { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "unknown" });
  });
});
