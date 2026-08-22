import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("long Story Bible frontend API", () => {
  it("does not reference a paid provider, FFmpeg, or browser storage", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "src", "api", "longStoryBibleApi.ts"), "utf8");
    expect(source).not.toMatch(/openai|runway|ffmpeg|localStorage|sessionStorage|indexedDB/i);
  });
});
