import { describe, expect, it, vi } from "vitest";
import { OpenAiAdapterError } from "../providers/openai-common.js";
import { callOpenAiTtsApi } from "./openai-narration-adapter.js";

const AUDIO_BYTES = Buffer.from("fake mp3 bytes");
function audioResponse(status: number, bytes: Buffer, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300, status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    json: async () => ({}),
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}
function errorResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300, status,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}
const noSleep = async () => {};

describe("callOpenAiTtsApi", () => {
  it("posts the audio/speech request and returns the raw audio bytes directly from the response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(200, AUDIO_BYTES, { "x-request-id": "req-1" }));
    const result = await callOpenAiTtsApi("sk-test", "scene one narration", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.bytes).toEqual(AUDIO_BYTES);
    expect(result.requestId).toBe("req-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(init.body))).toEqual({ model: "gpt-4o-mini-tts", input: "scene one narration", voice: "alloy", response_format: "mp3" });
  });

  it("uses caller-supplied model/voice/responseFormat instead of the defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(200, AUDIO_BYTES));
    await callOpenAiTtsApi("sk-test", "line", { model: "tts-1", voice: "nova", responseFormat: "wav", fetchImpl: fetchMock, sleep: noSleep });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ model: "tts-1", voice: "nova", response_format: "wav" });
  });

  it("rejects an empty or whitespace-only narration line without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(callOpenAiTtsApi("sk", "   ", { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects narration longer than the documented 4096-character input cap without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(callOpenAiTtsApi("sk", "a".repeat(4097), { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies a 401 as authentication and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, { error: { code: "invalid_api_key" } }));
    await expect(callOpenAiTtsApi("sk", "line", { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "authentication" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a 429, even with Retry-After present — TTS generation is paid and non-idempotent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(429, { error: {} }, { "retry-after": "0" }))
      .mockResolvedValueOnce(audioResponse(200, AUDIO_BYTES));
    await expect(callOpenAiTtsApi("sk", "line", { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "rate_limit" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a network-level fetch rejection — a lost response does not mean OpenAI never generated (and billed) audio", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(audioResponse(200, AUDIO_BYTES));
    await expect(callOpenAiTtsApi("sk", "line", { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty audio response body as empty_response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(200, Buffer.alloc(0)));
    await expect(callOpenAiTtsApi("sk", "line", { fetchImpl: fetchMock, sleep: noSleep })).rejects.toMatchObject({ category: "empty_response" });
  });

  it("is an instance of the shared OpenAiAdapterError with a Korean message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, { error: {} }));
    try {
      await callOpenAiTtsApi("sk", "line", { fetchImpl: fetchMock, sleep: noSleep });
      throw new Error("expected callOpenAiTtsApi to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAiAdapterError);
      expect((error as OpenAiAdapterError).message).toContain("인증");
    }
  });
});
