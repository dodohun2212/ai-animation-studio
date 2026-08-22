import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("local video preview isolation", () => {
  it("has no provider, network, subprocess, or FFmpeg dependency", async () => {
    const files = ["video-preview.service.ts", "local-video-submission.service.ts", "local-video-workflow.service.ts"];
    for (const file of files) {
      const source = await fs.readFile(path.join(import.meta.dirname, file), "utf8");
      expect(source).not.toMatch(/from\s+["'](?:openai|runway|node:child_process)["']/i);
      expect(source).not.toMatch(/\b(?:fetch|axios|spawn)\s*\(/);
      expect(source).not.toMatch(/\bffmpeg\b/i);
    }
  });
});
