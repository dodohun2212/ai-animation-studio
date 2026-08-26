import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError, classifyOpenAiHttpError } from "../providers/openai-common.js";
import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";
import { OPENAI_STORY_MODEL } from "../story/openai-story-adapter.js";

export { OpenAiAdapterError as OpenAiEpisodePlannerAdapterError };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const PROJECT_FIELDS = ["title", "logline", "overview", "genre", "tone", "theme", "starting_state", "midpoint", "ending_direction", "story_flow_summary"] as const;

export interface OpenAiEpisodeOutlineResult {
  project: Record<(typeof PROJECT_FIELDS)[number], string>;
  episodes: Array<{
    episode_number: number; title: string; summary: string; main_event: string; conflict: string;
    characters: string[]; locations: string[]; objects: string[]; reveals: string[]; hidden_secrets: string[];
    cliffhanger: string; next_episode_hook: string;
  }>;
}

/**
 * A direct port of Python's OpenAIEpisodePlannerAdapter.generate_outline — one Responses API call that returns
 * both the whole-project overview and every Episode's lightweight outline at once. Schema field names and
 * required-ness match the Python original exactly (including the string-array Episode fields, which the outline
 * screen does not currently surface but the schema still requires the model to produce, matching Python).
 */
function outlineSchema(episodeCount: number) {
  const stringList = { type: "array", items: { type: "string" } } as const;
  const projectSchema = {
    type: "object", additionalProperties: false,
    required: [...PROJECT_FIELDS],
    properties: Object.fromEntries(PROJECT_FIELDS.map((key) => [key, { type: "string" }])),
  };
  const episodeSchema = {
    type: "object", additionalProperties: false,
    required: ["episode_number", "title", "summary", "main_event", "conflict", "characters", "locations", "objects", "reveals", "hidden_secrets", "cliffhanger", "next_episode_hook"],
    properties: {
      episode_number: { type: "integer" }, title: { type: "string" }, summary: { type: "string" },
      main_event: { type: "string" }, conflict: { type: "string" },
      characters: stringList, locations: stringList, objects: stringList, reveals: stringList, hidden_secrets: stringList,
      cliffhanger: { type: "string" }, next_episode_hook: { type: "string" },
    },
  };
  return {
    type: "object", additionalProperties: false,
    required: ["project", "episodes"],
    properties: {
      project: projectSchema,
      episodes: { type: "array", minItems: episodeCount, maxItems: episodeCount, items: episodeSchema },
    },
  } as const;
}

function extractOutputText(body: unknown): string {
  if (!isObject(body) || !Array.isArray(body.output)) return "";
  for (const item of body.output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isObject(part) && part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

function isValidOutline(value: unknown, episodeCount: number): value is OpenAiEpisodeOutlineResult {
  if (!isObject(value) || !isObject(value.project) || !Array.isArray(value.episodes)) return false;
  const project = value.project;
  const episodes = value.episodes;
  if (!PROJECT_FIELDS.every((key) => typeof project[key] === "string")) return false;
  if (episodes.length !== episodeCount) return false;
  return episodes.every((item) => isObject(item)
    && Number.isInteger(item.episode_number)
    && typeof item.title === "string" && typeof item.summary === "string"
    && typeof item.main_event === "string" && typeof item.conflict === "string"
    && typeof item.cliffhanger === "string" && typeof item.next_episode_hook === "string"
    && ["characters", "locations", "objects", "reveals", "hidden_secrets"].every((key) => Array.isArray(item[key]) && (item[key] as unknown[]).every((entry) => typeof entry === "string")));
}

/**
 * Real OpenAI Responses API call for the whole-project outline (project overview + every Episode's lightweight
 * plan in one call) — plain fetch, same pattern as callOpenAiStoryApi. episodeCount must be 1-365, matching the
 * Python original's bound (Episode script generation's own per-Episode call has a tighter 1-30 elsewhere in
 * Python that this adapter does not need, since project.episode_count is already capped far below 365 by
 * APP_MAX_LONG_PROJECT_EPISODES on the TS side).
 */
export async function callOpenAiEpisodePlannerApi(
  apiKey: string,
  prompt: string,
  episodeCount: number,
  options: { model?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ result: OpenAiEpisodeOutlineResult; requestId: string }> {
  if (!Number.isInteger(episodeCount) || episodeCount < 1 || episodeCount > 365) throw new OpenAiAdapterError("invalid_request", "Episode 개요 수는 1~365 사이여야 합니다.");
  const model = options.model ?? OPENAI_STORY_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  assertRealNetworkCallAllowed("OpenAI", fetchImpl);

  // Never retried — generation is paid and non-idempotent (see OPENAI_DEFAULT_MAX_RETRIES's doc comment).
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, input: prompt,
        text: { format: { type: "json_schema", name: "long_project_outline", strict: true, schema: outlineSchema(episodeCount) } },
      }),
    });
  } catch {
    throw new OpenAiAdapterError("network", OPENAI_KOREAN_MESSAGES.network);
  }
  if (!response.ok) {
    const category = await classifyOpenAiHttpError(response);
    throw new OpenAiAdapterError(category, OPENAI_KOREAN_MESSAGES[category]);
  }
  const body: unknown = await response.json().catch(() => null);
  const requestId = response.headers.get("x-request-id") ?? "";
  const text = extractOutputText(body);
  if (!text) throw new OpenAiAdapterError("empty_response", "장기 프로젝트 개요 응답이 비어 있습니다.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new OpenAiAdapterError("invalid_response", "장기 프로젝트 개요 응답 JSON을 해석할 수 없습니다."); }
  if (!isValidOutline(parsed, episodeCount)) throw new OpenAiAdapterError("invalid_response", "장기 프로젝트 개요 응답 JSON을 해석할 수 없습니다.");
  return { result: parsed, requestId };
}
