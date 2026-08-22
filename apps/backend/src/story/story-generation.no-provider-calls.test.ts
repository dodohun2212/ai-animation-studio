import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("local Story generator isolation", () => {
  it("has no provider, network, subprocess, or FFmpeg dependency", async () => {
    const source = await fsPromises.readFile(path.join(import.meta.dirname, "story-generation.service.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:openai|runway|node:child_process)["']/i);
    expect(source).not.toMatch(/\b(?:fetch|axios|exec|spawn)\s*\(/);
    expect(source).not.toMatch(/\bffmpeg\b/i);
  });
});
