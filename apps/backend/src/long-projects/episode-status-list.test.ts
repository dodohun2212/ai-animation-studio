import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { LONG_EPISODE_STATUSES } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

/**
 * There is one list of Episode statuses, and it lives in the shared contract.
 *
 * A file that writes the whole set out again is a defect waiting for the next status to be added, and it had
 * already become one: `episode-mapping-owner.ts` stopped at `interrupted` and never gained `rendering`,
 * `completed` or `failed`, so an Episode that had been *finished* answered 500 on both of its Asset Mapping
 * routes. Measured on real data — both Episodes of a real long story, whose only fault was being done.
 *
 * The distinction this guard has to respect: a **gate** is deliberately a subset ("images may be generated from
 * these states"), and narrowing one is a decision. A **shape check** ("is this a well-formed Episode record")
 * must accept everything the type allows. The two look identical in the source, so the rule here is about size
 * rather than intent: a short list is somebody's gate and is left alone; a nearly-complete one is a copy of the
 * shared list and has to be the shared list.
 */
const CURRENT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const BACKEND_SOURCE = path.resolve(CURRENT_DIRECTORY, "..");

/**
 * How many distinct statuses a file may name before it counts as copying the list.
 *
 * Well below eighteen, because a copy that drops three is the failure this exists for, and well above the
 * largest real gate (seven) so that narrowing decisions are never touched.
 */
const COPY_THRESHOLD = 12;

async function collectSourceFiles(directory: string): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
  }
  return files;
}

describe("Episode statuses are named once", () => {
  it("has no source file writing out most of the list instead of importing it", async () => {
    const files = await collectSourceFiles(BACKEND_SOURCE);
    // 140 against 158 real backend sources. A floor this far under the real number is not a floor: at 50, the
    // whole long-projects directory could stop being scanned and this would still pass — which is the one
    // failure a sweep has (Cowork Round 452 found the same slack in the frontend's own guard). Deliberately
    // under the real count so deleting a few files is not a red suite.
    expect(files.length).toBeGreaterThan(140);

    let widest = 0;
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      const named = LONG_EPISODE_STATUSES.filter((status) => source.includes(`"${status}"`));
      widest = Math.max(widest, named.length);
      expect(
        named.length,
        `${path.relative(BACKEND_SOURCE, file)} names ${named.length} of the ${LONG_EPISODE_STATUSES.length} Episode statuses — import LONG_EPISODE_STATUSES instead of copying it`,
      ).toBeLessThan(COPY_THRESHOLD);
    }

    // The gates are still here and still narrow: a run where nothing named a status at all would mean this guard
    // had stopped looking at anything, which is the failure a sweep is worst at noticing about itself.
    expect(widest).toBeGreaterThan(0);
  });

  it("still lets a gate name a handful of statuses", async () => {
    // The counterpart. Without it, a threshold of 1 would pass the test above while forbidding every gate in the
    // directory — the guard would be "correct" and unusable.
    const source = await fs.readFile(path.join(BACKEND_SOURCE, "long-projects", "episode-continuity.service.ts"), "utf8");
    const named = LONG_EPISODE_STATUSES.filter((status) => source.includes(`"${status}"`));
    expect(named.length).toBeGreaterThan(3);
    expect(named.length).toBeLessThan(COPY_THRESHOLD);
  });
});
