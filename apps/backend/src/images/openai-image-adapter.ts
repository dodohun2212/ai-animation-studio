import {
  OPENAI_DEFAULT_MAX_RETRIES, OPENAI_KOREAN_MESSAGES, OPENAI_RETRYABLE_CATEGORIES,
  OpenAiAdapterError, backoffSeconds, classifyOpenAiHttpError, defaultSleep, parseRetryAfterSeconds,
} from "../providers/openai-common.js";

export const OPENAI_IMAGE_MODEL = "gpt-image-2";
export const OPENAI_IMAGE_SIZE = "1024x1536";
export const OPENAI_IMAGE_QUALITY = "medium";
export const OPENAI_IMAGE_FORMAT = "png";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Real OpenAI Images API call for one scene's reference-free PNG, using a plain fetch request (no SDK
 * dependency), matching Python's `OpenAIImageAdapter.generate` no-reference path. Reference-image edits
 * (Python's `images.edit`) are a follow-up increment tracked in the migration plan.
 */
export async function callOpenAiImageApi(
  apiKey: string,
  prompt: string,
  options: {
    model?: string; size?: string; quality?: string; outputFormat?: string;
    maxRetries?: number; fetchImpl?: typeof fetch; sleep?: (seconds: number) => Promise<void>;
  } = {},
): Promise<{ bytes: Buffer; requestId: string }> {
  const model = options.model ?? OPENAI_IMAGE_MODEL;
  const size = options.size ?? OPENAI_IMAGE_SIZE;
  const quality = options.quality ?? OPENAI_IMAGE_QUALITY;
  const outputFormat = options.outputFormat ?? OPENAI_IMAGE_FORMAT;
  const maxRetries = options.maxRetries ?? OPENAI_DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt, size, quality, output_format: outputFormat }),
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
    const encoded = isObject(body) && Array.isArray(body.data) && isObject(body.data[0]) && typeof body.data[0].b64_json === "string"
      ? body.data[0].b64_json : "";
    if (!encoded) throw new OpenAiAdapterError("empty_response", "이미지 응답이 비어 있습니다.");
    let bytes: Buffer;
    try { bytes = Buffer.from(encoded, "base64"); } catch { throw new OpenAiAdapterError("invalid_response", "이미지 Base64 응답이 손상되었습니다."); }
    if (bytes.length === 0) throw new OpenAiAdapterError("invalid_response", "이미지 Base64 응답이 손상되었습니다.");
    return { bytes, requestId };
  }
}
