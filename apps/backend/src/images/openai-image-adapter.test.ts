import { describe, expect, it, vi } from "vitest";
import { OpenAiAdapterError } from "../providers/openai-common.js";
import { callOpenAiImageApi } from "./openai-image-adapter.js";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=";
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}
const noSleep = async () => {};

describe("callOpenAiImageApi", () => {
  it("posts the images/generations request and returns decoded PNG bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }, { "x-request-id": "req-1" }));
    const result = await callOpenAiImageApi("sk-test", "scene one", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.bytes).toEqual(Buffer.from(PNG_BASE64, "base64"));
    expect(result.requestId).toBe("req-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(init.body))).toEqual({ model: "gpt-image-2", prompt: "scene one", size: "1024x1536", quality: "medium", output_format: "png" });
  });

  it("uses caller-supplied model/size/quality/format instead of the defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    await callOpenAiImageApi("sk-test", "p", { model: "m", size: "1024x1024", quality: "high", outputFormat: "jpeg", fetchImpl: fetchMock, sleep: noSleep });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ model: "m", size: "1024x1024", quality: "high", output_format: "jpeg" });
  });

  it("classifies a 401 as authentication and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key" } }));
    await expect(callOpenAiImageApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "authentication" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 honoring Retry-After, then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: {} }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    const sleep = vi.fn(noSleep);
    const result = await callOpenAiImageApi("sk", "p", { fetchImpl: fetchMock, sleep, maxRetries: 2 });
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries a network-level fetch rejection, then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    const result = await callOpenAiImageApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it("rejects a response with no b64_json as empty_response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    await expect(callOpenAiImageApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "empty_response" });
  });

  it("is an instance of the shared OpenAiAdapterError with a Korean message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: {} }));
    try {
      await callOpenAiImageApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep });
      throw new Error("expected callOpenAiImageApi to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAiAdapterError);
      expect((error as OpenAiAdapterError).message).toContain("인증");
    }
  });
});
