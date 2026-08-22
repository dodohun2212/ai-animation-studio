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
  /images\/generations/,
  /videos\/generations/,
  /videos\/merge/,
];

const FILES_UNDER_TEST = [
  path.join("api", "longProjectsApi.ts"),
  path.join("components", "CreateLongProjectForm.tsx"),
  path.join("components", "LongProjectList.tsx"),
  path.join("components", "LongProjectDetail.tsx"),
  path.join("components", "LongProjectSettingsScreen.tsx"),
  path.join("components", "LongProjectOutlineScreen.tsx"),
];

describe("Long-project outline code never touches script, image, video, Provider, or FFmpeg surfaces", () => {
  it("does not reference client-side storage, console.*, a Provider hostname, FFmpeg, or a generation route", async () => {
    const srcRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");

    for (const relativePath of FILES_UNDER_TEST) {
      const content = await fsPromises.readFile(path.join(srcRoot, relativePath), "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(pattern.test(content), `${relativePath} unexpectedly matched forbidden pattern ${pattern}`).toBe(false);
      }
    }
  });

  it("only sends outline-preview and outline-approval requests through fetch, never generation endpoints", async () => {
    const srcRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
    const content = await fsPromises.readFile(path.join(srcRoot, "api", "longProjectsApi.ts"), "utf8");
    expect(content).toMatch(/longProjectOutlinePreview/);
    expect(content).toMatch(/longProjectOutlineApproval/);
  });
});
