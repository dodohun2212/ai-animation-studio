import { describe, expect, it, vi } from "vitest";
import { OpenAiStoryAdapterError, callOpenAiStoryApi } from "./openai-story-adapter.js";

const SCENE = (number: number) => ({
  number, description: `d${number}`, visual_action: "v", start_motion: "s", main_motion: "m", end_motion: "e",
  shot_size: "medium", camera_angle: "eye", composition: "centered", lens_feel: "natural", focus_subject: "hero",
  camera_motion: "forward", environment_motion: "ambient", motion_speed: "normal", motion_intensity: "moderate",
  expression_change: "focused", continuity_hint: "continue", narration: "narration line",
});
const VALID_STORY = { title: "t", synopsis: "s", ending: "e", scenes: [1, 2, 3, 4, 5, 6].map(SCENE) };

function responsesBody(story: unknown): unknown {
  return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(story) }] }] };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

const noSleep = async () => {};

describe("callOpenAiStoryApi", () => {
  it("posts the strict json_schema request and returns the parsed, validated Story", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(VALID_STORY), { "x-request-id": "req-1" }));
    const result = await callOpenAiStoryApi("sk-test", "prompt text", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.story).toEqual(VALID_STORY);
    expect(result.requestId).toBe("req-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "gpt-5.6-luna", input: "prompt text" });
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "animation_story", strict: true });
  });

  it("uses a caller-supplied model instead of the default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(VALID_STORY)));
    await callOpenAiStoryApi("sk-test", "prompt", { model: "custom-model", fetchImpl: fetchMock, sleep: noSleep });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).model).toBe("custom-model");
  });

  it("classifies a 401 as authentication and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key", message: "bad key" } }));
    await expect(callOpenAiStoryApi("sk-bad", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "authentication" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies insufficient_quota as quota_or_permission and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: "insufficient_quota", message: "no quota" } }));
    await expect(callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "quota_or_permission" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies content_policy_violation as safety_policy and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { code: "content_policy_violation", message: "blocked" } }));
    await expect(callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "safety_policy" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a bare 400 as invalid_request and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: {} }));
    await expect(callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies context_length_exceeded distinctly from a generic invalid_request and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { code: "context_length_exceeded", message: "too long" } }));
    await expect(callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "context_length_exceeded" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 up to maxRetries, honoring Retry-After, then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "slow down" } }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, responsesBody(VALID_STORY)));
    const sleep = vi.fn(noSleep);
    const result = await callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep, maxRetries: 2 });
    expect(result.story).toEqual(VALID_STORY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up on a 429 after exhausting maxRetries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { error: {} }));
    await expect(callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 1 }))
      .rejects.toMatchObject({ category: "rate_limit" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("retries a 500 server error, then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: {} }))
      .mockResolvedValueOnce(jsonResponse(200, responsesBody(VALID_STORY)));
    const result = await callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.story).toEqual(VALID_STORY);
  });

  it("retries a network-level fetch rejection as network, then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, responsesBody(VALID_STORY)));
    const result = await callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result.story).toEqual(VALID_STORY);
  });

  it("classifies a persistent network failure as network after exhausting retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 1 }))
      .rejects.toMatchObject({ category: "network" });
  });

  it("rejects an empty output_text as empty_response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { output: [] }));
    await expect(callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "empty_response" });
  });

  it("rejects unparsable JSON text as invalid_response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { output: [{ type: "message", content: [{ type: "output_text", text: "{not json" }] }] }));
    await expect(callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_response" });
  });

  it("rejects JSON that fails the strict six-scene Story schema as invalid_response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody({ title: "t", synopsis: "s", ending: "e", scenes: [SCENE(1)] })));
    await expect(callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_response" });
  });

  it("is an instance of OpenAiStoryAdapterError with a Korean message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: {} }));
    try {
      await callOpenAiStoryApi("sk", "p", { fetchImpl: fetchMock, sleep: noSleep });
      throw new Error("expected callOpenAiStoryApi to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAiStoryAdapterError);
      expect((error as OpenAiStoryAdapterError).message).toContain("인증");
    }
  });
});
