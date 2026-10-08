import { assertRealNetworkCallAllowed } from "../providers/no-test-network.guard.js";
import { GEMINI_SUMMARY_MODEL } from "../news/gemini-summary-adapter.js";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SUMMARY_MODEL}:generateContent`;
const TIMEOUT_MS = 90_000;

export type MemeVideoProviderFailure = "invalid_video" | "quota" | "credential" | "unavailable" | "empty";

export class MemeVideoProviderError extends Error {
  constructor(readonly failure: MemeVideoProviderFailure) {
    super(`Meme video provider failed: ${failure}`);
    this.name = "MemeVideoProviderError";
  }
}

/** One selected public YouTube video, with no retries or fallback to another model. */
export async function askGeminiAboutMemeVideo(videoId: string, apiKey: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  if (!/^[\w-]{11}$/u.test(videoId)) throw new MemeVideoProviderError("invalid_video");
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const prompt = [
    "이 공개 영상 한 편을 보고, 화면과 음성에서 실제로 관찰한 밈 요소만 한국어 JSON으로 적어 주세요.",
    "형식: {\"spokenPhrase\": string|null, \"gesture\": string|null, \"beats\": [{\"approxSeconds\": number|null, \"description\": string}], \"uncertainties\": string[]}.",
    "spokenPhrase는 밈을 알아보는 데 필요한 짧은 말만 적고, 길게 전사하지 마세요. 들리지 않으면 null입니다.",
    "gesture는 몸짓·표정·움직임을 간결하게 묘사하세요. 확인할 수 없으면 null입니다.",
    "beats는 1~5개입니다. 시간은 확실하지 않으면 null로 두고, 빠른 움직임은 놓칠 수 있음을 uncertainties에 적으세요.",
    "영상 제목이나 해시태그에서 내용을 추측하지 마세요. 영상 자체에서 확인하지 못한 장면·소리·타이밍을 만들지 마세요.",
    "설명이나 마크다운 없이 JSON 객체만 출력하세요.",
  ].join("\n");
  assertRealNetworkCallAllowed("Gemini meme video analysis", fetchImpl);
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ file_data: { file_uri: videoUrl } }, { text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { throw new MemeVideoProviderError("unavailable"); }
  if (!response.ok) {
    if (response.status === 429) throw new MemeVideoProviderError("quota");
    if (response.status === 401 || response.status === 403) throw new MemeVideoProviderError("credential");
    throw new MemeVideoProviderError("unavailable");
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new MemeVideoProviderError("empty"); }
  const candidate = (payload as { candidates?: unknown[] } | null)?.candidates?.[0];
  const parts = (candidate as { content?: { parts?: unknown[] } } | undefined)?.content?.parts;
  if (!Array.isArray(parts)) throw new MemeVideoProviderError("empty");
  const text = parts.map((part) => typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("").trim();
  if (!text) throw new MemeVideoProviderError("empty");
  return text;
}
