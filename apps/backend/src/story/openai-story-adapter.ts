import { DEFAULT_SCENE_COUNT } from "@ai-animation-studio/shared";
import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError, classifyOpenAiHttpError } from "../providers/openai-common.js";
import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";
import { validateStory, type StoredStory } from "./story-generation.service.js";

export const OPENAI_STORY_MODEL = "gpt-5.6-luna";
export { OpenAiAdapterError as OpenAiStoryAdapterError };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The scene fields the model must return, in the order the prompt asks for them.
 *
 * Named rather than spelled inline because the prompt template lists the same eighteen and the two must not
 * drift. `additionalProperties: false` plus this `required` list means the model has to fill every one of them,
 * so a field dropped from the template does not become a field the model may omit — it becomes a field the
 * model fills without having been told what it is for. That failure passes validation and comes back as a
 * wrong picture, which is worse than the one that stops (Cowork Round 614 ②).
 */
export const STORY_SCENE_FIELDS = [
  "number", "description", "visual_action", "start_motion", "main_motion", "end_motion",
  "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject",
  "camera_motion", "environment_motion", "motion_speed", "motion_intensity",
  "expression_change", "continuity_hint", "narration",
] as const;

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
          required: [...STORY_SCENE_FIELDS],
          properties: {
            number: { type: "integer", minimum: 1, maximum: sceneCount },
            description: { type: "string" }, visual_action: { type: "string" },
            start_motion: { type: "string" }, main_motion: { type: "string" }, end_motion: { type: "string" },
            shot_size: { type: "string" }, camera_angle: { type: "string" }, composition: { type: "string" },
            lens_feel: { type: "string" }, focus_subject: { type: "string" }, camera_motion: { type: "string" },
            environment_motion: { type: "string" }, motion_speed: { type: "string" }, motion_intensity: { type: "string" },
            expression_change: { type: "string" }, continuity_hint: { type: "string" },
            // Narration/subtitle sentence, naturally readable within the scene's clip duration — no stage directions or camera language.
            narration: { type: "string" },
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
 * (no SDK dependency). Never retried — generation is paid and non-idempotent, and a `fetch` failure does not
 * mean OpenAI never generated (and billed) a Story, only that we never saw the response (see
 * OPENAI_DEFAULT_MAX_RETRIES's doc comment).
 */
export async function callOpenAiStoryApi(
  apiKey: string,
  prompt: string,
  options: { model?: string; fetchImpl?: typeof fetch; sceneCount?: number } = {},
): Promise<{ story: StoredStory; requestId: string }> {
  const model = options.model ?? OPENAI_STORY_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  assertRealNetworkCallAllowed("OpenAI", fetchImpl);
  const sceneCount = options.sceneCount ?? DEFAULT_SCENE_COUNT;

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
    throw new OpenAiAdapterError("network", OPENAI_KOREAN_MESSAGES.network);
  }
  if (!response.ok) {
    const category = await classifyOpenAiHttpError(response);
    throw new OpenAiAdapterError(category, OPENAI_KOREAN_MESSAGES[category]);
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
