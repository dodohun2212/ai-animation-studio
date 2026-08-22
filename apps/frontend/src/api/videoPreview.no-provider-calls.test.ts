import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";

import { describe, expect, it } from "vitest";

const FORBIDDEN_PATTERNS = [
  /localStorage/,
  /sessionStorage/,
  /indexedDB/i,
  /console\s*\./,
  /api\.openai\.com/,
  /runwayml\.com/,
  /\bffmpeg\b/i,
  /child_process/,
  /\bspawn\s*\(/,
  /videoGeneration\s*\(/,
  /videos\/generations/,
];

const FILES_UNDER_TEST = [
  path.join("api", "videoPreviewApi.ts"),
  path.join("components", "VideoPromptPreviewScreen.tsx"),
];

describe("Video prompt preview code never touches generation, Provider, or FFmpeg surfaces", () => {
  it("does not reference client-side storage, console.*, a Provider hostname, FFmpeg, or the generation route", async () => {
    const srcRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");

    for (const relativePath of FILES_UNDER_TEST) {
      const content = await fsPromises.readFile(path.join(srcRoot, relativePath), "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(pattern.test(content), `${relativePath} unexpectedly matched forbidden pattern ${pattern}`).toBe(false);
      }
    }
  });
});
