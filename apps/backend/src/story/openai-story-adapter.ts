import {
  OPENAI_DEFAULT_MAX_RETRIES, OPENAI_KOREAN_MESSAGES, OPENAI_RETRYABLE_CATEGORIES,
  OpenAiAdapterError, backoffSeconds, classifyOpenAiHttpError, defaultSleep, parseRetryAfterSeconds,
} from "../providers/openai-common.js";
import { validateStory, type StoredStory } from "./story-generation.service.js";

export const OPENAI_STORY_MODEL = "gpt-5.6-luna";
export { OpenAiAdapterError as OpenAiStoryAdapterError };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The scene count is a per-project setting (2-12, see MIN/MAX_SCENE_COUNT in shared/domain.ts), so this schema is built per request rather than a fixed constant. */
function storySchema(sceneCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "synopsis", "scenes", "ending"],
    properties: {
      title: { type: "string" },
      synopsis: { type: "string" },
      ending: { type: "string" },
      scenes: {
        type: "array", minItems: sceneCount, maxItems: sceneCount,
        items: {
          type: "object", additionalProperties: false,
          required: [
            "number", "description", "visual_action", "start_motion", "main_motion", "end_motion",
            "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject",
            "camera_motion", "environment_motion", "motion_speed", "motion_intensity",
            "expression_change", "continuity_hint",
          ],
          properties: {
            number: { type: "integer", minimum: 1, maximum: sceneCount },
            description: { type: "string" }, visual_action: { type: "string" },
            start_motion: { type: "string" }, main_motion: { type: "string" }, end_motion: { type: "string" },
            shot_size: { type: "string" }, camera_angle: { type: "string" }, composition: { type: "string" },
            lens_feel: { type: "string" }, focus_subject: { type: "string" }, camera_motion: { type: "string" },
            environment_motion: { type: "string" }, motion_speed: { type: "string" }, motion_intensity: { type: "string" },
            expression_change: { type: "string" }, continuity_hint: { type: "string" },
          },
        },
      },
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

/**
 * Real OpenAI Responses API call for the strict six-scene Story JSON schema, using a plain fetch request
 * (no SDK dependency) so error classification and the bounded retry policy stay under direct, testable control.
 */
export async function callOpenAiStoryApi(
  apiKey: string,
  prompt: string,
  options: { model?: string; maxRetries?: number; fetchImpl?: typeof fetch; sleep?: (seconds: number) => Promise<void>; sceneCount?: number } = {},
): Promise<{ story: StoredStory; requestId: string }> {
  const model = options.model ?? OPENAI_STORY_MODEL;
  const maxRetries = options.maxRetries ?? OPENAI_DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const sceneCount = options.sceneCount ?? 6;

  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model, input: prompt,
          text: { format: { type: "json_schema", name: "animation_story", strict: true, schema: storySchema(sceneCount) } },
        }),
      });
    } catch {
      if (attempt >= maxRetries) throw new OpenAiAdapterError("network", OPENAI_KOREAN_MESSAGES.network);
      await sleep(backoffSeconds(attempt));
      attempt += 1; continue;
    }
    if (!response.ok) {
      const category = await classifyOpenAiHttpError(response);
      if (!OPENAI_RETRYABLE_CATEGORIES.has(category) || attempt >= maxRetries) throw new OpenAiAdapterError(category, OPENAI_KOREAN_MESSAGES[category]);
      const retryAfter = parseRetryAfterSeconds(response);
      await sleep(Math.max(0, Math.min(4, retryAfter ?? backoffSeconds(attempt))));
      attempt += 1; continue;
    }
    const body: unknown = await response.json().catch(() => null);
    const requestId = response.headers.get("x-request-id") ?? "";
    const text = extractOutputText(body);
    if (!text) throw new OpenAiAdapterError("empty_response", "대본 응답이 비어 있습니다.");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new OpenAiAdapterError("invalid_response", "대본 응답 JSON을 해석할 수 없습니다."); }
    try { validateStory(parsed, sceneCount); } catch { throw new OpenAiAdapterError("invalid_response", "대본 응답 JSON을 해석할 수 없습니다."); }
    return { story: parsed, requestId };
  }
}
