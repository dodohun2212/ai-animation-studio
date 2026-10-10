import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError, describeOpenAiHttpError } from "../providers/openai-common.js";
import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";
import type { NovelStoryAnalysis } from "@ai-animation-studio/shared";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const requiredText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "logline", "genre", "tone", "theme", "characters", "episodes", "warnings"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    logline: { type: "string", minLength: 1, maxLength: 800 },
    genre: { type: "string", minLength: 1, maxLength: 100 },
    tone: { type: "string", minLength: 1, maxLength: 300 },
    theme: { type: "string", minLength: 1, maxLength: 500 },
    characters: {
      type: "array", maxItems: 40,
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "role", "appearance", "personality"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80 },
          role: { type: "string", enum: ["protagonist", "supporting"] },
          appearance: { type: "string", minLength: 1, maxLength: 500 },
          personality: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
    episodes: {
      type: "array", minItems: 1, maxItems: 20,
      items: {
        type: "object", additionalProperties: false,
        required: ["episodeNumber", "title", "summary", "mainEvent", "conflict", "cliffhanger", "nextEpisodeHook"],
        properties: {
          episodeNumber: { type: "integer", minimum: 1, maximum: 20 },
          title: { type: "string", minLength: 1, maxLength: 120 },
          summary: { type: "string", minLength: 1, maxLength: 1200 },
          mainEvent: { type: "string", minLength: 1, maxLength: 600 },
          conflict: { type: "string", minLength: 1, maxLength: 600 },
          cliffhanger: { type: "string", minLength: 1, maxLength: 500 },
          nextEpisodeHook: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
    warnings: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
  },
} as const;

function extractOutputText(body: unknown): string {
  if (!isObject(body) || !Array.isArray(body.output)) return "";
  for (const item of body.output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) if (isObject(part) && part.type === "output_text" && typeof part.text === "string") return part.text;
  }
  return "";
}

function validateAnalysis(value: unknown, episodeCount: number): NovelStoryAnalysis {
  if (!isObject(value) || !requiredText(value.title, 120) || !requiredText(value.logline, 800)
    || !requiredText(value.genre, 100) || !requiredText(value.tone, 300) || !requiredText(value.theme, 500)
    || !Array.isArray(value.characters) || value.characters.length > 40 || !Array.isArray(value.episodes)
    || value.episodes.length !== episodeCount || !Array.isArray(value.warnings) || value.warnings.length > 10) {
    throw new OpenAiAdapterError("invalid_response", "이야기 분석 응답의 형식이 올바르지 않습니다.");
  }
  const rawCharacters = value.characters;
  const characters = rawCharacters.map((item, index) => {
    if (!isObject(item) || !requiredText(item.name, 80) || (item.role !== "protagonist" && item.role !== "supporting")
      || !requiredText(item.appearance, 500) || !requiredText(item.personality, 500)) throw new OpenAiAdapterError("invalid_response", "이야기 분석의 인물 형식이 올바르지 않습니다.");
    return { ...item, id: `character-${index + 1}` } as NovelStoryAnalysis["characters"][number];
  });
  const episodes = value.episodes.map((item, index) => {
    if (!isObject(item) || item.episodeNumber !== index + 1 || !requiredText(item.title, 120)
      || !requiredText(item.summary, 1200) || !requiredText(item.mainEvent, 600) || !requiredText(item.conflict, 600)
      || !requiredText(item.cliffhanger, 500) || !requiredText(item.nextEpisodeHook, 500)) throw new OpenAiAdapterError("invalid_response", "회차 분석 응답의 형식이 올바르지 않습니다.");
    return item as unknown as NovelStoryAnalysis["episodes"][number];
  });
  if (!value.characters.some((item) => isObject(item) && item.role === "protagonist")
    || !value.warnings.every((warning) => typeof warning === "string" && warning.length <= 300)) {
    throw new OpenAiAdapterError("invalid_response", "주인공 또는 주의 표지 형식이 올바르지 않습니다.");
  }
  return { title: value.title, logline: value.logline, genre: value.genre, tone: value.tone, theme: value.theme, characters, episodes, warnings: value.warnings as string[] };
}

export async function callOpenAiStoryAnalysisApi(
  apiKey: string,
  model: string,
  prompt: string,
  episodeCount: number,
  fetchImpl: typeof fetch = fetch,
): Promise<NovelStoryAnalysis> {
  assertRealNetworkCallAllowed("OpenAI", fetchImpl);
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        store: false,
        input: prompt,
        max_output_tokens: 10_000,
        text: { format: { type: "json_schema", name: "novel_story_analysis", strict: true, schema: { ...analysisSchema, properties: { ...analysisSchema.properties, episodes: { ...analysisSchema.properties.episodes, minItems: episodeCount, maxItems: episodeCount } } } } },
      }),
    });
  } catch {
    throw new OpenAiAdapterError("network", OPENAI_KOREAN_MESSAGES.network);
  }
  if (!response.ok) {
    const failure = await describeOpenAiHttpError(response);
    throw new OpenAiAdapterError(failure.category, OPENAI_KOREAN_MESSAGES[failure.category], failure);
  }
  const text = extractOutputText(await response.json().catch(() => null));
  if (!text) throw new OpenAiAdapterError("empty_response", "이야기 분석 응답이 비어 있습니다.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new OpenAiAdapterError("invalid_response", "이야기 분석 JSON을 읽지 못했습니다."); }
  return validateAnalysis(parsed, episodeCount);
}

export interface NovelStoryChunkSummary {
  themes: string[];
  characterNotes: string[];
  events: string[];
  unresolvedQuestions: string[];
}

const chunkSummarySchema = {
  type: "object", additionalProperties: false,
  required: ["themes", "characterNotes", "events", "unresolvedQuestions"],
  properties: {
    themes: { type: "array", maxItems: 12, items: { type: "string", maxLength: 300 } },
    characterNotes: { type: "array", maxItems: 30, items: { type: "string", maxLength: 500 } },
    events: { type: "array", maxItems: 60, items: { type: "string", maxLength: 500 } },
    unresolvedQuestions: { type: "array", maxItems: 12, items: { type: "string", maxLength: 300 } },
  },
} as const;

export async function callOpenAiStoryChunkAnalysisApi(
  apiKey: string,
  model: string,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NovelStoryChunkSummary> {
  assertRealNetworkCallAllowed("OpenAI", fetchImpl);
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, store: false, input: prompt, max_output_tokens: 8_000,
        text: { format: { type: "json_schema", name: "novel_story_chunk_summary", strict: true, schema: chunkSummarySchema } } }),
    });
  } catch { throw new OpenAiAdapterError("network", OPENAI_KOREAN_MESSAGES.network); }
  if (!response.ok) {
    const failure = await describeOpenAiHttpError(response);
    throw new OpenAiAdapterError(failure.category, OPENAI_KOREAN_MESSAGES[failure.category], failure);
  }
  const text = extractOutputText(await response.json().catch(() => null));
  if (!text) throw new OpenAiAdapterError("empty_response", "긴 글 일부 분석 응답이 비어 있습니다.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new OpenAiAdapterError("invalid_response", "긴 글 일부 분석 JSON을 읽지 못했습니다."); }
  if (!isObject(value) || !Array.isArray(value.themes) || !Array.isArray(value.characterNotes)
    || !Array.isArray(value.events) || !Array.isArray(value.unresolvedQuestions)
    || !value.themes.every((item) => typeof item === "string" && item.length <= 300)
    || !value.characterNotes.every((item) => typeof item === "string" && item.length <= 500)
    || !value.events.every((item) => typeof item === "string" && item.length <= 500)
    || !value.unresolvedQuestions.every((item) => typeof item === "string" && item.length <= 300)) {
    throw new OpenAiAdapterError("invalid_response", "긴 글 일부 분석 응답의 형식이 올바르지 않습니다.");
  }
  return value as unknown as NovelStoryChunkSummary;
}
