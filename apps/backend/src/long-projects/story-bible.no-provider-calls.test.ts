import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("Story Bible storage", () => {
  it("does not import a provider, network client, FFmpeg, or subprocess", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "src", "long-projects", "story-bible.service.ts"), "utf8");
    expect(source).not.toMatch(/openai|runway|ffmpeg|child_process|fetch\s*\(/i);
  });
});
