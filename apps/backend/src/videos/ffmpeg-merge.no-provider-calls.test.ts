import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every file in this directory except the named adapter, rather than two files named by hand.
 *
 * Measured: a real `fetch("https://api.openai.com/…")` appended to `subtitle-file.ts` — which runs during a
 * merge — left all 178 tests in this directory green. The list covered what existed when it was written, and
 * this directory has grown a lot since.
 *
 * `spawn` and FFmpeg are not forbidden here the way they are in the image and Story directories: this is where
 * the merge lives, and running FFmpeg locally is its job. What must not appear anywhere but the adapter is a
 * network client.
 */
const PROVIDER_BOUNDARY = new Set(["runway-video-adapter.ts"]);

describe("FFmpeg merge isolation", () => {
  it("keeps every file in this directory except the adapter free of any provider or network client", async () => {
    const directory = import.meta.dirname;
    const files = (await fs.readdir(directory))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !PROVIDER_BOUNDARY.has(name));
    expect(files.length).toBeGreaterThan(2);

    for (const name of files) {
      const source = await fs.readFile(path.join(directory, name), "utf8");
      expect(source, name).not.toMatch(/from\s+["'](?:openai|runway|axios)["']/i);
      expect(source, name).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("uses only local child-process argument arrays", async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, "ffmpeg-merge.service.ts"), "utf8");
    expect(source).toContain("shell: false");
  });
});
