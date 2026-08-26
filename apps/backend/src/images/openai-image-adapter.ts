import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError, classifyOpenAiHttpError } from "../providers/openai-common.js";
import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";

export const OPENAI_IMAGE_MODEL = "gpt-image-2";
export const OPENAI_IMAGE_SIZE = "1024x1536";
export const OPENAI_IMAGE_QUALITY = "medium";
export const OPENAI_IMAGE_FORMAT = "png";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Real OpenAI Images API call for one scene's reference-free PNG, using a plain fetch request (no SDK
 * dependency), matching Python's `OpenAIImageAdapter.generate` no-reference path.
 */
export async function callOpenAiImageApi(
  apiKey: string,
  prompt: string,
  options: {
    model?: string; size?: string; quality?: string; outputFormat?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ bytes: Buffer; requestId: string }> {
  const model = options.model ?? OPENAI_IMAGE_MODEL;
  const size = options.size ?? OPENAI_IMAGE_SIZE;
  const quality = options.quality ?? OPENAI_IMAGE_QUALITY;
  const outputFormat = options.outputFormat ?? OPENAI_IMAGE_FORMAT;
  const fetchImpl = options.fetchImpl ?? fetch;
  assertRealNetworkCallAllowed("OpenAI", fetchImpl);

  // Never retried — generation is paid and non-idempotent (see OPENAI_DEFAULT_MAX_RETRIES's doc comment). A
  // single attempt only; a failure here is the caller's own provider-error path to surface and let the user
  // decide whether to try again.
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt, size, quality, output_format: outputFormat }),
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
  const encoded = isObject(body) && Array.isArray(body.data) && isObject(body.data[0]) && typeof body.data[0].b64_json === "string"
    ? body.data[0].b64_json : "";
  if (!encoded) throw new OpenAiAdapterError("empty_response", "이미지 응답이 비어 있습니다.");
  let bytes: Buffer;
  try { bytes = Buffer.from(encoded, "base64"); } catch { throw new OpenAiAdapterError("invalid_response", "이미지 Base64 응답이 손상되었습니다."); }
  if (bytes.length === 0) throw new OpenAiAdapterError("invalid_response", "이미지 Base64 응답이 손상되었습니다.");
  return { bytes, requestId };
}

/**
 * Real OpenAI Images-edit API call, matching Python's `OpenAIImageAdapter.generate_for_size`'s Reference path
 * (`client.images.edit(model=..., image=files, prompt=..., size=..., quality=..., output_format=...)`). Sends a
 * multipart/form-data request with one `image[]` part per approved Reference PNG — no SDK dependency, same
 * request/retry pattern as `callOpenAiImageApi`.
 */
export async function callOpenAiImageEditApi(
  apiKey: string,
  prompt: string,
  referenceImages: readonly Buffer[],
  options: {
    model?: string; size?: string; quality?: string; outputFormat?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ bytes: Buffer; requestId: string }> {
  if (referenceImages.length === 0) throw new OpenAiAdapterError("invalid_request", "Reference 이미지가 최소 1개 필요합니다.");
  const model = options.model ?? OPENAI_IMAGE_MODEL;
  const size = options.size ?? OPENAI_IMAGE_SIZE;
  const quality = options.quality ?? OPENAI_IMAGE_QUALITY;
  const outputFormat = options.outputFormat ?? OPENAI_IMAGE_FORMAT;
  const fetchImpl = options.fetchImpl ?? fetch;
  assertRealNetworkCallAllowed("OpenAI", fetchImpl);

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("output_format", outputFormat);
  referenceImages.forEach((bytes, index) => {
    form.append("image[]", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `reference_${index}.png`);
  });

  // Never retried — generation is paid and non-idempotent, and this call re-uploads every Reference image on
  // each attempt, so a retry would also mean paying the upload cost twice (see OPENAI_DEFAULT_MAX_RETRIES's doc
  // comment).
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
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
  const encoded = isObject(body) && Array.isArray(body.data) && isObject(body.data[0]) && typeof body.data[0].b64_json === "string"
    ? body.data[0].b64_json : "";
  if (!encoded) throw new OpenAiAdapterError("empty_response", "이미지 응답이 비어 있습니다.");
  let bytes: Buffer;
  try { bytes = Buffer.from(encoded, "base64"); } catch { throw new OpenAiAdapterError("invalid_response", "이미지 Base64 응답이 손상되었습니다."); }
  if (bytes.length === 0) throw new OpenAiAdapterError("invalid_response", "이미지 Base64 응답이 손상되었습니다.");
  return { bytes, requestId };
}
