import {
  OPENAI_DEFAULT_MAX_RETRIES, OPENAI_KOREAN_MESSAGES, OPENAI_RETRYABLE_CATEGORIES,
  OpenAiAdapterError, backoffSeconds, classifyOpenAiHttpError, defaultSleep, parseRetryAfterSeconds,
} from "../providers/openai-common.js";

/** Cheapest real-time TTS model; supports `instructions` for tone (unused today) — see TTS_ESTIMATED_COST_USD's doc comment for the pricing basis. */
export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const OPENAI_TTS_VOICE = "alloy";
export const OPENAI_TTS_FORMAT = "mp3";
/** POST /v1/audio/speech's documented input cap. */
export const OPENAI_TTS_INPUT_MAX_LENGTH = 4096;

/**
 * Real OpenAI Audio Speech API call for one scene's narration line, using a plain fetch request (no SDK
 * dependency), matching the image/story adapters' shape. Unlike Images/Responses, this endpoint returns the
 * audio bytes directly as the response body — never JSON — so a successful response is read with
 * arrayBuffer(), not json().
 */
export async function callOpenAiTtsApi(
  apiKey: string,
  input: string,
  options: {
    model?: string; voice?: string; responseFormat?: string;
    maxRetries?: number; fetchImpl?: typeof fetch; sleep?: (seconds: number) => Promise<void>;
  } = {},
): Promise<{ bytes: Buffer; requestId: string }> {
  if (!input.trim()) throw new OpenAiAdapterError("invalid_request", "내레이션 문장이 비어 있습니다.");
  if (input.length > OPENAI_TTS_INPUT_MAX_LENGTH) throw new OpenAiAdapterError("invalid_request", "내레이션 문장이 너무 깁니다.");
  const model = options.model ?? OPENAI_TTS_MODEL;
  const voice = options.voice ?? OPENAI_TTS_VOICE;
  const responseFormat = options.responseFormat ?? OPENAI_TTS_FORMAT;
  const maxRetries = options.maxRetries ?? OPENAI_DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input, voice, response_format: responseFormat }),
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
    const requestId = response.headers.get("x-request-id") ?? "";
    let bytes: Buffer;
    try { bytes = Buffer.from(await response.arrayBuffer()); } catch { throw new OpenAiAdapterError("invalid_response", "오디오 응답이 손상되었습니다."); }
    if (bytes.length === 0) throw new OpenAiAdapterError("empty_response", "오디오 응답이 비어 있습니다.");
    return { bytes, requestId };
  }
}
