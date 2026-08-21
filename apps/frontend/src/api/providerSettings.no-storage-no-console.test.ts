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
];

const FILES_UNDER_TEST = [
  path.join("api", "providerSettingsApi.ts"),
  path.join("validation", "credential.ts"),
  path.join("components", "ProviderCredentialCard.tsx"),
  path.join("components", "ProviderSettingsScreen.tsx"),
];

describe("Provider settings code has no client-side storage, console, or direct Provider network usage", () => {
  it("does not reference localStorage, sessionStorage, IndexedDB, console.*, or a Provider hostname", async () => {
    const srcRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");

    for (const relativePath of FILES_UNDER_TEST) {
      const content = await fsPromises.readFile(path.join(srcRoot, relativePath), "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(pattern.test(content), `${relativePath} unexpectedly matched forbidden pattern ${pattern}`).toBe(false);
      }
    }
  });
});
