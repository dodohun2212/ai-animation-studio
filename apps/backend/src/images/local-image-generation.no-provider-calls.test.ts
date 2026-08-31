import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every file in this directory except the named adapter, rather than two files named by hand.
 *
 * The hand-written list was the whole weakness: it covered the two services that existed when it was written and
 * nothing added since. Measured — a real `fetch("https://api.openai.com/…")` appended to
 * `image-reference-selection.ts`, which sits directly on the paid path assembling what gets sent, left all 80
 * tests in this directory green.
 *
 * A directory sweep covers whatever is added next by default, and the allowlist below says in one place exactly
 * where this directory is allowed to talk to a provider. Adding a file to that list is then a deliberate,
 * reviewable act rather than something that happens by not thinking about it.
 */
const PROVIDER_BOUNDARY = new Set(["openai-image-adapter.ts"]);

describe("local image generator isolation", () => {
  it("keeps every file in this directory except the adapter free of provider, network, subprocess and FFmpeg dependencies", async () => {
    const directory = import.meta.dirname;
    const files = (await fs.readdir(directory))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !PROVIDER_BOUNDARY.has(name));
    expect(files.length).toBeGreaterThan(2); // the sweep is real, not an empty list quietly passing

    for (const name of files) {
      const source = await fs.readFile(path.join(directory, name), "utf8");
      expect(source, name).not.toMatch(/from\s+["'](?:openai|runway|node:child_process)["']/i);
      expect(source, name).not.toMatch(/\b(?:fetch|axios|spawn)\s*\(/);
      expect(source, name).not.toMatch(/\bffmpeg\b/i);
    }
  });
});
