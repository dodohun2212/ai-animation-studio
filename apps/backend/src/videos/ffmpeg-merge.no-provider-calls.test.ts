import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("FFmpeg merge isolation", () => {
  it("uses only local child-process argument arrays and no provider or network client", async () => {
    const sources = await Promise.all(["ffmpeg-merge.service.ts", "video-merge.service.ts"].map((file) => fs.readFile(path.join(import.meta.dirname, file), "utf8")));
    for (const source of sources) {
      expect(source).not.toMatch(/from\s+["'](?:openai|runway|axios)["']/i);
      expect(source).not.toMatch(/\bfetch\s*\(/);
    }
    expect(sources[0]).toContain("shell: false");
  });
});
