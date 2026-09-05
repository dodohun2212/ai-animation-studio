import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A file that writes out most of a contract's value set is a copy, and copies of the contract fail expensively.
 *
 * The Episode-status version of this guard (long-projects/episode-status-list.test.ts) has existed for a while
 * and has a real incident behind it. It watches one list. On 2026-09-05 a sweep of every value set in the
 * contract against every source found six more copies that nothing was watching — four of them here, in code
 * that reads files off disk:
 *
 *   mapping-storage.ts               all 6 mapping statuses, all 4 assignment sources, all 3 version policies
 *   legacy-reference-migration.ts    all 5 asset types
 *
 * A reader's copy does not fail by missing a feature. A value added to the contract and not to the copy makes
 * every stored file carrying that value unreadable — which is how a project once vanished from its own list
 * with no error anywhere (Cowork Round 436) — or, in the migration's case, quietly rewrites it as something
 * else. Both were only found because someone went looking.
 *
 * The rule is about proportion, not intent, because a gate and a copy look identical in the source: a **gate**
 * is deliberately a subset ("images may be generated from these states") and narrowing one is a decision; a
 * **copy** is nearly the whole set. Naming most of a set is the copy.
 */
const CURRENT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const BACKEND_SOURCE = CURRENT_DIRECTORY;
const SHARED_SOURCE = path.resolve(CURRENT_DIRECTORY, "..", "..", "..", "packages", "shared", "src");

/**
 * The one place a near-complete list is a decision rather than a copy.
 *
 * Same shape as atomic-write-coverage.test.ts's exception list, and checked the same way: an exception that
 * stops applying has to fail rather than sit there. Keyed by `<relative file>::<set name>`.
 */
const ALLOWED = new Map<string, string>([
  // It is LONG_EPISODE_STATUSES_BEFORE_IMAGES minus generating_images, and that one difference is the whole
  // point: this asks whether generation has *started* (lock the aspect ratio, money is already moving), not
  // whether pictures exist. Folding them would either let the ratio change mid-run or call an Episode
  // picture-having before it has any. See both comments at the two declarations.
  ["long-projects/long-projects.service.ts::LONG_EPISODE_STATUSES_BEFORE_IMAGES", "a gate that is deliberately this list minus generating_images"],
]);

/** Naming this share of a set, and at least this many of its members, is a copy rather than a gate. */
const COPY_RATIO = 0.7;
const COPY_MINIMUM = 5;
/**
 * Sets smaller than COPY_MINIMUM were not watched at all, because below that the proportion rule cannot tell a
 * copy from a deliberate gate. The client's copy of this guard learned on 2026-09-05 what that costs: the four
 * AUDIO_MODES sat written out in a screen, in the exact shape this file exists to catch, and passed.
 *
 * Naming *every* member is unambiguous at any size — a gate that lists the whole set narrows nothing. So a
 * complete list is a copy, and the ratio rule stays for the partial ones.
 *
 * 🟠 "Complete" has to mean the literal names the whole set *and nothing else*. Without that, a legitimate
 * longer list is reported for every small set it happens to contain — the six Episode draft states contain both
 * LONG_EPISODE_OUTLINE_STATUSES, and the six stored video-record statuses contain all five VIDEO_JOB_STATUSES
 * plus "submitting", which the API deliberately does not have. Those are different lists, not copies.
 */
const SMALLEST_WATCHED_SET = 2;

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

/** Every `export const X = ["a", "b", ...] as const;` the contract declares, with its members. */
async function contractValueSets(): Promise<Map<string, string[]>> {
  const sets = new Map<string, string[]>();
  for (const file of await collectSourceFiles(SHARED_SOURCE)) {
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(/export const (\w+) = \[([^\]]*)\] as const;/g)) {
      const members = [...match[2]!.matchAll(/"([^"]+)"/g)].map((member) => member[1]!);
      if (members.length >= SMALLEST_WATCHED_SET) sets.set(match[1]!, members);
    }
  }
  return sets;
}

describe("contract value sets are named once", () => {
  it("finds the sets it is supposed to be watching", async () => {
    // A sweep's own worst failure is silently stopping to look. If the contract is ever reorganised so this
    // parser matches nothing, the test below would pass by finding no copies anywhere.
    const sets = await contractValueSets();
    expect([...sets.keys()].sort()).toContain("LONG_EPISODE_STATUSES");
    expect(sets.size).toBeGreaterThanOrEqual(4);
  });

  it("has no source file writing most of a contract set out instead of importing it", async () => {
    const sets = await contractValueSets();
    const files = await collectSourceFiles(BACKEND_SOURCE);
    expect(files.length).toBeGreaterThan(140);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      // Counted inside one bracketed literal, not across the whole file. A file naming five values in five
      // different branches has not written the list out; a file with them between one pair of brackets has.
      // Counting per file flagged three switches and two narrow gates that are doing neither.
      const literals = [...source.matchAll(/\[[^[\]]*\]/g)].map((match) => match[0]);
      for (const [name, members] of sets) {
        // A complete list is a copy whatever the size; a partial one has to clear the proportion rule.
        const threshold = members.length < COPY_MINIMUM ? members.length : Math.max(COPY_MINIMUM, Math.ceil(members.length * COPY_RATIO));
        const named = Math.max(0, ...literals.map((literal) => {
          const inSet = members.filter((member) => literal.includes(`"${member}"`)).length;
          // A literal naming values beyond this set is a different list, not a copy of it.
          const total = [...literal.matchAll(/"[^"]*"/g)].length;
          return inSet === members.length && total > members.length ? 0 : inSet;
        }));
        const key = `${path.relative(BACKEND_SOURCE, file).split(path.sep).join("/")}::${name}`;
        if (named >= threshold && !ALLOWED.has(key)) {
          offenders.push(`${path.relative(BACKEND_SOURCE, file)} names ${named} of ${name}'s ${members.length} values in one literal — import ${name} instead of copying it`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names only exceptions that would still be flagged, so one cannot outlive its reason", async () => {
    // Without this, an exception stays after the copy it excused is gone, and quietly covers the next one
    // that appears in the same file for the same set.
    const sets = await contractValueSets();
    for (const [key, reason] of ALLOWED) {
      const [relative, name] = key.split("::");
      const members = sets.get(name!);
      expect(members, `${key} names a set the contract no longer declares`).toBeDefined();
      const source = await fs.readFile(path.join(BACKEND_SOURCE, relative!), "utf8");
      const literals = [...source.matchAll(/\[[^[\]]*\]/g)].map((match) => match[0]);
      const named = Math.max(0, ...literals.map((literal) => members!.filter((member) => literal.includes(`"${member}"`)).length));
      expect(named, `${key} is no longer a near-complete list — drop the exception (${reason})`)
        .toBeGreaterThanOrEqual(members!.length < COPY_MINIMUM ? members!.length : Math.max(COPY_MINIMUM, Math.ceil(members!.length * COPY_RATIO)));
    }
  });
});
