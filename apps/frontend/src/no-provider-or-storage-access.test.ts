// @vitest-environment node
//
// Reads source files off disk rather than rendering anything; jsdom gives `import.meta.url` an http:// URL,
// which cannot be turned back into a path.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";

import { describe, expect, it } from "vitest";

/**
 * One sweep over every frontend source file, instead of three hand-written lists.
 *
 * The lists were right the day they were written. Files added afterwards were covered by nobody — the same
 * shape the backend found in its own guards (CLI Round 404, D-039): the guard is not broken, its reach is
 * stale. A directory scan inverts the default, so a new file is covered unless someone deliberately writes its
 * name into an exception below.
 *
 * The narrow guards next to this one are kept rather than replaced. They assert things this cannot — that a
 * particular module still routes through the outline endpoints, for instance — and the two catch different
 * mistakes.
 *
 * 🔴 What is NOT banned here, on purpose: /ffmpeg/i. The narrow lists ban it and are right to, because those
 * files have no business naming it. Repo-wide it is wrong — `FFMPEG_UNAVAILABLE` is an error code this app
 * displays a message for, and a rule that fired on it would be a rule people learn to work around. A sweep
 * that has to be silenced is worse than a smaller sweep that means what it says.
 */
const FORBIDDEN = [
  // The app is a local desktop client; nothing here may keep its own copy of state in the browser.
  { pattern: /localStorage/, why: "browser storage" },
  { pattern: /sessionStorage/, why: "browser storage" },
  { pattern: /indexedDB/i, why: "browser storage" },
  // A paid provider is reached by the local backend, never from here. A hostname in this tree would mean a
  // request that skips every budget check the backend performs.
  { pattern: /api\.openai\.com/, why: "provider hostname" },
  { pattern: /runwayml\.com/, why: "provider hostname" },
  // Node process APIs do not belong in code that runs in a renderer.
  { pattern: /child_process/, why: "node process API" },
  { pattern: /\bspawn\s*\(/, why: "node process API" },
];

/**
 * `console.*` is banned with one exception rather than left out of the sweep.
 *
 * The exception is a deliberate warning about a response whose shape the app did not expect — a real event
 * worth leaving a trace of. Naming the file here is the point: adding a second one is then a decision someone
 * makes on purpose, which is exactly what the hand-written lists stopped requiring.
 */
const CONSOLE_ALLOWED = new Set([path.join("api", "projectsApi.ts")]);

/**
 * A floor, not an exact count: files come and go, but a sweep that suddenly matches almost nothing has broken
 * rather than passed. Without this, a wrong root or a bad filter reports success over an empty list — the
 * failure mode a guard is least likely to notice about itself.
 *
 * Raised from 60 when the tree had grown to 88 source files: a floor a third below the real count would have
 * sat green while the sweep quietly stopped seeing whole directories, which is the thing it exists to catch.
 * Kept below the real number on purpose — this must not fail because a file was deleted.
 */
const MINIMUM_FILES_SWEPT = 80;

async function sourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      found.push(path.relative(root, full));
    }
  }
  await walk(root);
  return found.sort();
}

describe("frontend source never reaches a provider, browser storage, or the OS directly", () => {
  it("sweeps every file rather than a list written once", async () => {
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const files = await sourceFiles(root);
    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_FILES_SWEPT);

    const offences: string[] = [];
    for (const relativePath of files) {
      const content = await fs.readFile(path.join(root, relativePath), "utf8");
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(content)) offences.push(`${relativePath}: ${why} (${pattern})`);
      }
      if (/console\s*\./.test(content) && !CONSOLE_ALLOWED.has(relativePath)) {
        offences.push(`${relativePath}: console.* outside the allowed list`);
      }
    }
    expect(offences).toEqual([]);
  });

  // Without this the allowance could quietly outlive the line it was written for, and the next reader would
  // find a name in a list with nothing behind it.
  it("keeps the console exception honest — the allowed file still uses it", async () => {
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    for (const allowed of CONSOLE_ALLOWED) {
      const content = await fs.readFile(path.join(root, allowed), "utf8");
      expect(/console\s*\./.test(content), `${allowed} no longer uses console.* — drop it from the list`).toBe(true);
    }
  });
});
