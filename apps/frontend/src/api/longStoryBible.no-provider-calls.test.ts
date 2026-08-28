// @vitest-environment node
//
// This file reads a source file off disk rather than rendering anything, and jsdom gives `import.meta.url` an
// http:// URL, which cannot be turned back into a path. Node is the environment this test actually needs.
import * as fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("long Story Bible frontend API", () => {
  it("does not reference a paid provider, FFmpeg, or browser storage", async () => {
    // Resolved from this file rather than process.cwd(): run from the repo root, that path does not exist and
    // the guard fails on a missing file instead of on the thing it guards.
    const source = await fs.readFile(new URL("./longStoryBibleApi.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/openai|runway|ffmpeg|localStorage|sessionStorage|indexedDB/i);
  });
});
