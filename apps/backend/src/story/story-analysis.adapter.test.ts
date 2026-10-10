import { describe, expect, it, vi } from "vitest";
import { callOpenAiStoryAnalysisApi, callOpenAiStoryChunkAnalysisApi } from "./story-analysis.adapter.js";

const analysis = {
  title: "새 제목", logline: "새로운 이야기", genre: "판타지", tone: "따뜻함", theme: "용기",
  characters: [{ name: "나린", role: "protagonist", appearance: "짧은 은발", personality: "침착함" }],
  episodes: [{ episodeNumber: 1, title: "첫걸음", summary: "문을 연다", mainEvent: "길을 발견한다", conflict: "문이 닫힌다", cliffhanger: "빛이 보인다", nextEpisodeHook: "누가 기다릴까" }],
  warnings: [],
};

describe("callOpenAiStoryAnalysisApi", () => {
  it("requests a non-stored strict structured response and validates episode ordering", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(analysis) }] }],
    }), { status: 200 }));

    const result = await callOpenAiStoryAnalysisApi("test-key", "test-model", "prompt", 1, fetchImpl as typeof fetch);
    expect(result.characters[0]).toMatchObject({ id: "character-1", name: "나린", role: "protagonist" });
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({ model: "test-model", store: false, max_output_tokens: 10_000 });
    expect(request.text).toMatchObject({ format: { type: "json_schema", strict: true, name: "novel_story_analysis" } });
  });

  it("rejects incomplete analysis instead of saving an unusable result", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...analysis, episodes: [] }) }] }] }), { status: 200 }));
    await expect(callOpenAiStoryAnalysisApi("test-key", "test-model", "prompt", 1, fetchImpl as typeof fetch)).rejects.toThrow("이야기 분석 응답의 형식이 올바르지 않습니다.");
  });
});

describe("callOpenAiStoryChunkAnalysisApi", () => {
  it("requests an ephemeral strict abstract summary without returning source text", async () => {
    const summary = { themes: ["희망"], characterNotes: ["익명의 여행자가 고향을 떠난다."], events: ["문이 열린다."], unresolvedQuestions: ["누가 문을 열었나?"] };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(summary) }] }] }), { status: 200 }));
    await expect(callOpenAiStoryChunkAnalysisApi("test-key", "test-model", "prompt", fetchImpl as typeof fetch)).resolves.toEqual(summary);
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({ model: "test-model", store: false, max_output_tokens: 8_000 });
    expect(request.text).toMatchObject({ format: { type: "json_schema", strict: true, name: "novel_story_chunk_summary" } });
  });
});
