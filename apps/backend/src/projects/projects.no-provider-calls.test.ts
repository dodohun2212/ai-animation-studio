import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";

import { describe, expect, it } from "vitest";

const FORBIDDEN_PATTERNS = [
  /\bchild_process\b/,
  /\bnode:child_process\b/,
  /\bopenai\b/i,
  /\brunway\b/i,
  /\bffmpeg\b/i,
  /\bffprobe\b/i,
  /\bnode-fetch\b/,
  /\bhttps?\.request\b/,
  /\bhttps?\.get\(/,
  /\baxios\b/,
  /\bwebsocket\b/i,
  /\bfetch\(/,
];

async function projectSourceFiles(): Promise<string[]> {
  const directory = path.dirname(url.fileURLToPath(import.meta.url));
  const entries = await fsPromises.readdir(directory);
  return entries
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(directory, name));
}

describe("short-project create/list/get code has no provider or process dependencies", () => {
  it("does not reference OpenAI, Runway, FFmpeg, subprocess, or network adapters", async () => {
    const files = await projectSourceFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = await fsPromises.readFile(file, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(
          pattern.test(content),
          `${path.basename(file)} unexpectedly matched forbidden pattern ${pattern}`,
        ).toBe(false);
      }
    }
  });
});
