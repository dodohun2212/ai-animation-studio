import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("Story Bible storage", () => {
  it("does not import a provider, network client, FFmpeg, or subprocess", async () => {
    // Resolved from this file rather than process.cwd(): run from the repo root, that path does not exist and
    // the guard fails on a missing file instead of on the thing it guards.
    const source = await fs.readFile(new URL("./story-bible.service.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/openai|runway|ffmpeg|child_process|fetch\s*\(/i);
  });
});
