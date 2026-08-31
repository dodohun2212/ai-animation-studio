import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * This directory had no static sweep at all — its two existing guards stub `fetch` and drive a real local-fake
 * flow, which is the stronger kind of check but only covers the code those particular flows reach. Thirty-six
 * source files, every paid pipeline for the long-story side among them, and nothing said a word about a network
 * client appearing in any of them.
 *
 * Every provider call here goes through an adapter owned by another directory (`../images/openai-image-adapter`,
 * `../videos/runway-video-adapter`, `../story/openai-story-adapter`), and those are guarded where they live. So
 * this directory has no provider boundary of its own: nothing in it should ever hold a network client, which is
 * why the allowlist is empty and stays that way.
 *
 * Deliberately narrower than the image and Story sweeps: `spawn` and FFmpeg are not forbidden, because Episode
 * merging runs FFmpeg locally the same way the short-project merge does.
 */
const PROVIDER_BOUNDARY = new Set<string>();

describe("long-story directory holds no network client", () => {
  it("keeps every source file free of a provider package import, fetch, or axios", async () => {
    const directory = import.meta.dirname;
    const files = (await fs.readdir(directory))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !PROVIDER_BOUNDARY.has(name));
    expect(files.length).toBeGreaterThan(20); // the sweep is real, not an empty list quietly passing

    for (const name of files) {
      const source = await fs.readFile(path.join(directory, name), "utf8");
      expect(source, name).not.toMatch(/from\s+["'](?:openai|runway|axios)["']/i);
      expect(source, name).not.toMatch(/\b(?:fetch|axios)\s*\(/);
    }
  });
});
