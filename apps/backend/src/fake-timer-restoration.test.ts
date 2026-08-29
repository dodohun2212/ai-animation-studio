import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A test file that starts fake timers must put them back.
 *
 * Fake timers persist across the tests in a file. A test that leaves them on silently starves every real
 * `setTimeout` in whatever runs next — including `project-lock.ts`'s acquire retry loop, whose whole job is to
 * wait and try again. The next test does not fail with a wrong value; it hangs, and it is not the test that
 * broke anything. Both `local-video-workflow.runway.test.ts` and `episode-videos.runway.test.ts` carry an
 * `afterEach` written after exactly that happened, and their comments say so.
 *
 * `afterEach` specifically, not "the file mentions useRealTimers somewhere": restoring at the end of the test
 * that started them is the case that does not survive the test failing partway through, which is when a leak
 * is least welcome and most confusing.
 *
 * Repo-wide because the hazard is not backend-specific — the frontend has a fake-timer file too, and
 * `decision-doc-references.test.ts` already scans every workspace from here.
 */

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const SOURCE_ROOTS = [
  path.join(REPOSITORY_ROOT, "apps", "backend", "src"),
  path.join(REPOSITORY_ROOT, "apps", "frontend", "src"),
  path.join(REPOSITORY_ROOT, "apps", "desktop", "src"),
  path.join(REPOSITORY_ROOT, "packages", "shared", "src"),
];

const SELF = path.resolve(import.meta.filename);

function testFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(full));
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** The body of every `afterEach(...)` in a file, so "restores" means restores there and not merely anywhere. */
function afterEachBodies(source: string): string {
  return [...source.matchAll(/afterEach\(([\s\S]*?)\n\s*\}\);/g)].map((match) => match[1] ?? "").join("\n");
}

describe("fake timers are handed back", () => {
  const files = SOURCE_ROOTS.flatMap(testFiles).filter((file) => path.resolve(file) !== SELF);
  const withFakeTimers = files.filter((file) => fs.readFileSync(file, "utf8").includes("useFakeTimers"));

  // This file is a scan, and a scan that reads nothing looks exactly like a scan that found nothing.
  it("found the test files, and some of them use fake timers", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(withFakeTimers.length).toBeGreaterThan(0);
  });

  it("restores real timers in an afterEach wherever fake ones are started", () => {
    const leaking = withFakeTimers
      .filter((file) => !afterEachBodies(fs.readFileSync(file, "utf8")).includes("useRealTimers"))
      .map((file) => path.relative(REPOSITORY_ROOT, file));

    // Named, not counted — the failure has to say which file would hang the next one.
    expect(leaking).toEqual([]);
  });
});
