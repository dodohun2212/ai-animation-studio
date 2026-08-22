import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("local image generator isolation", () => {
  it("has no provider, network, subprocess, or FFmpeg dependency", async () => {
    const sources = await Promise.all(["local-image-generation.service.ts", "image-review.service.ts"].map((file) =>
      fs.readFile(path.join(import.meta.dirname, file), "utf8"),
    ));
    for (const source of sources) {
      expect(source).not.toMatch(/from\s+["'](?:openai|runway|node:child_process)["']/i);
      expect(source).not.toMatch(/\b(?:fetch|axios|spawn)\s*\(/);
      expect(source).not.toMatch(/\bffmpeg\b/i);
    }
  });
});
