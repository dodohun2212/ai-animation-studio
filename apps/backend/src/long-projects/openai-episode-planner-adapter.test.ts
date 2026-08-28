import { describe, expect, it, vi } from "vitest";
import { OpenAiEpisodePlannerAdapterError, callOpenAiEpisodePlannerApi } from "./openai-episode-planner-adapter.js";

const PROJECT = { title: "t", logline: "l", overview: "o", genre: "g", tone: "to", theme: "th", starting_state: "ss", midpoint: "mp", ending_direction: "ed", story_flow_summary: "sf" };
const EPISODE = (number: number) => ({
  episode_number: number, title: `Episode ${number}`, summary: "s", main_event: "m", conflict: "c",
  characters: [], locations: [], objects: [], reveals: [], hidden_secrets: [],
  cliffhanger: "cf", next_episode_hook: "nh",
});
const VALID_OUTLINE = { project: PROJECT, episodes: [EPISODE(1), EPISODE(2)] };

function responsesBody(result: unknown): unknown {
  return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] };
}
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } } as unknown as Response;
}

describe("callOpenAiEpisodePlannerApi", () => {
  it("posts the strict json_schema request sized to episodeCount and returns the parsed outline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(VALID_OUTLINE), { "x-request-id": "req-1" }));
    const result = await callOpenAiEpisodePlannerApi("sk-test", "prompt text", 2, { fetchImpl: fetchMock });
    expect(result.result).toEqual(VALID_OUTLINE);
    expect(result.requestId).toBe("req-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "gpt-5.6-luna", input: "prompt text" });
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "long_project_outline", strict: true });
    expect(body.text.format.schema.properties.episodes).toMatchObject({ minItems: 2, maxItems: 2 });
  });

  it("uses a caller-supplied model instead of the default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(VALID_OUTLINE)));
    await callOpenAiEpisodePlannerApi("sk", "p", 2, { model: "custom-model", fetchImpl: fetchMock });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).model).toBe("custom-model");
  });

  it("rejects an episodeCount outside 1-365 before ever calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(callOpenAiEpisodePlannerApi("sk", "p", 0, { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "invalid_request" });
    await expect(callOpenAiEpisodePlannerApi("sk", "p", 366, { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies a 401 as authentication and never retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key", message: "bad key" } }));
    await expect(callOpenAiEpisodePlannerApi("sk-bad", "p", 2, { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "authentication" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a 429, even with Retry-After present — outline generation is paid and non-idempotent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "slow down" } }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, responsesBody(VALID_OUTLINE)));
    await expect(callOpenAiEpisodePlannerApi("sk", "p", 2, { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "rate_limit" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a network-level fetch rejection — a lost response does not mean OpenAI never generated (and billed) an outline", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(jsonResponse(200, responsesBody(VALID_OUTLINE)));
    await expect(callOpenAiEpisodePlannerApi("sk", "p", 2, { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty output_text as empty_response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { output: [] }));
    await expect(callOpenAiEpisodePlannerApi("sk", "p", 2, { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "empty_response" });
  });

  it("rejects unparsable JSON text as invalid_response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { output: [{ type: "message", content: [{ type: "output_text", text: "{not json" }] }] }));
    await expect(callOpenAiEpisodePlannerApi("sk", "p", 2, { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("rejects a response whose episode count does not match the requested count as invalid_response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody({ project: PROJECT, episodes: [EPISODE(1)] })));
    await expect(callOpenAiEpisodePlannerApi("sk", "p", 2, { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("rejects a response missing a required project field as invalid_response", async () => {
    const { title: _title, ...incompleteProject } = PROJECT;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody({ project: incompleteProject, episodes: [EPISODE(1), EPISODE(2)] })));
    await expect(callOpenAiEpisodePlannerApi("sk", "p", 2, { fetchImpl: fetchMock })).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("is an instance of OpenAiEpisodePlannerAdapterError with a Korean message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: {} }));
    try {
      await callOpenAiEpisodePlannerApi("sk", "p", 2, { fetchImpl: fetchMock });
      throw new Error("expected callOpenAiEpisodePlannerApi to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAiEpisodePlannerAdapterError);
      expect((error as InstanceType<typeof OpenAiEpisodePlannerAdapterError>).message).toContain("인증");
    }
  });
});
