import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every file in this directory except the named adapter — see local-image-generation.no-provider-calls.test.ts
 * for what the hand-written list missed and how that was measured.
 */
const PROVIDER_BOUNDARY = new Set(["openai-story-adapter.ts"]);

describe("local Story generator isolation", () => {
  it("keeps every file in this directory except the adapter free of provider, network, subprocess and FFmpeg dependencies", async () => {
    const directory = import.meta.dirname;
    const files = (await fsPromises.readdir(directory))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !PROVIDER_BOUNDARY.has(name));
    expect(files.length).toBeGreaterThan(1);

    for (const name of files) {
      const source = await fsPromises.readFile(path.join(directory, name), "utf8");
      expect(source, name).not.toMatch(/from\s+["'](?:openai|runway|node:child_process)["']/i);
      expect(source, name).not.toMatch(/\b(?:fetch|axios|exec|spawn)\s*\(/);
      expect(source, name).not.toMatch(/\bffmpeg\b/i);
    }
  });
});
