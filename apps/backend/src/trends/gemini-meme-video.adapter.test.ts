import { describe, expect, it, vi } from "vitest";

import { GEMINI_SUMMARY_MODEL } from "../news/gemini-summary-adapter.js";
import { askGeminiAboutMemeVideo, MemeVideoProviderError } from "./gemini-meme-video.adapter.js";

describe("Gemini public YouTube video adapter", () => {
  it("sends one selected canonical video URL and returns only provider text", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"spokenPhrase":null,"gesture":"손을 든다","beats":[],"uncertainties":[]}' }] } }] }) } as Response)) as unknown as typeof fetch;
    const result = await askGeminiAboutMemeVideo("aaaaaaaaaaa", "mock-key", fetchImpl);
    expect(result).toContain("손을 든다");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(String(url)).toContain(`/models/${GEMINI_SUMMARY_MODEL}:generateContent`);
    expect(JSON.parse(String(init?.body)).contents[0].parts[0].file_data.file_uri).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    expect(String(url)).not.toContain("mock-key");
  });

  it("refuses an invalid ID before any provider request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(askGeminiAboutMemeVideo("https://evil.example", "mock-key", fetchImpl)).rejects.toMatchObject({ failure: "invalid_video" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("distinguishes quota and empty responses without retrying", async () => {
    const quotaFetch = vi.fn(async () => ({ ok: false, status: 429 } as Response)) as unknown as typeof fetch;
    await expect(askGeminiAboutMemeVideo("aaaaaaaaaaa", "mock-key", quotaFetch)).rejects.toMatchObject({ failure: "quota" });
    expect(quotaFetch).toHaveBeenCalledTimes(1);
    const emptyFetch = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [] }) } as Response)) as unknown as typeof fetch;
    await expect(askGeminiAboutMemeVideo("aaaaaaaaaaa", "mock-key", emptyFetch)).rejects.toBeInstanceOf(MemeVideoProviderError);
    expect(emptyFetch).toHaveBeenCalledTimes(1);
  });
});
