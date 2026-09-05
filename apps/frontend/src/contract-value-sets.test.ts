import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A file that writes out most of a contract's value set is a copy, and copies of the contract fail expensively.
 *
 * The backend has had a version of this for one list, with a real incident behind it. This side had none at
 * all, which is why on 2026-09-05 a sweep found two copies here that nothing was watching:
 *
 *   api/longProjectsApi.ts     all 18 Episode statuses, in the Set its response guard checks against
 *   api/audioLibraryApi.ts     all 5 licence kinds, likewise
 *
 * Both are read-side guards, so the failure is not a missing feature: a value added to the contract and not to
 * the copy makes this client call a perfectly good response malformed, and the screen says 서버 응답을 확인할
 * 수 없습니다 about a server that is working. Both were only found because someone went looking.
 *
 * The rule is about proportion, not intent, because a gate and a copy look identical in the source: a **gate**
 * is deliberately a subset ("images may be generated from these states") and narrowing one is a decision; a
 * **copy** is nearly the whole set. Naming most of a set is the copy.
 */
// path.dirname(fileURLToPath(import.meta.url)), the form the other sweeps in this app use — `new URL(".")`
// does not resolve to a file URL under this test environment.
const CURRENT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SOURCE = CURRENT_DIRECTORY;
const SHARED_SOURCE = path.resolve(CURRENT_DIRECTORY, "..", "..", "..", "packages", "shared", "src");

/**
 * The one place a near-complete list is a decision rather than a copy.
 *
 * Same shape as atomic-write-coverage.test.ts's exception list, and checked the same way: an exception that
 * stops applying has to fail rather than sit there. Keyed by `<relative file>::<set name>`.
 */
const ALLOWED = new Map<string, string>([
  ["components/LongEpisodeOutlineScreen.tsx::LONG_EPISODE_OUTLINE_STATUSES",
    "which Episodes this screen may edit is a decision about LongEpisodeStatus; a new outline status must not widen it by itself"],
]);

/** Naming this share of a set, and at least this many of its members, is a copy rather than a gate. */
const COPY_RATIO = 0.7;
const COPY_MINIMUM = 5;
/**
 * Below COPY_MINIMUM members the proportion rule cannot tell a copy from a gate, so those sets were not
 * watched at all — and AUDIO_MODES has four. Its whole list sat in mergeAudio.tsx as
 * `["narration", "narration+bgm", "bgm", "silent"] as AudioMode[]`, the exact shape this file exists to catch,
 * and passed because the contract had no array for it and four would have been too few anyway.
 *
 * Naming *every* member is unambiguous at any size: a gate that lists the whole set is not narrowing anything.
 * So a complete list is a copy, and the ratio rule stays for the partial ones.
 *
 * 🟠 "Complete" has to mean the literal names the whole set *and nothing else*. Without that, a legitimate
 * longer list is reported for every small set it happens to contain — the six Episode draft states contain both
 * LONG_EPISODE_OUTLINE_STATUSES, and the six stored video-record statuses contain all five VIDEO_JOB_STATUSES
 * plus "submitting", which the API deliberately does not have. Those are different lists, not copies.
 *
 * Widening it found four more the same afternoon, all in api/mappingsApi.ts: the whole of
 * ASSET_MAPPING_ASSIGNMENT_SOURCES and ASSET_MAPPING_VERSION_POLICIES, written out beside the contract arrays
 * that already held them.
 *
 * 🟠 One literal can be reported against several sets when they overlap — the three version policies are also
 * the three style-link policies, and contain both protagonist ones. That reads as four findings for one line,
 * and the fix is the same single import, so it is left rather than given machinery of its own.
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
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
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
    const files = await collectSourceFiles(FRONTEND_SOURCE);
    // Well under the real count so deleting a few files is not a red suite, and far enough above zero that
    // a collector which stopped finding anything cannot pass by finding no copies.
    expect(files.length).toBeGreaterThan(70);

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
        const key = `${path.relative(FRONTEND_SOURCE, file).split(path.sep).join("/")}::${name}`;
        if (named >= threshold && !ALLOWED.has(key)) {
          offenders.push(`${path.relative(FRONTEND_SOURCE, file)} names ${named} of ${name}'s ${members.length} values in one literal — import ${name} instead of copying it`);
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
      const source = await fs.readFile(path.join(FRONTEND_SOURCE, relative!), "utf8");
      const literals = [...source.matchAll(/\[[^[\]]*\]/g)].map((match) => match[0]);
      const named = Math.max(0, ...literals.map((literal) => members!.filter((member) => literal.includes(`"${member}"`)).length));
      expect(named, `${key} is no longer a near-complete list — drop the exception (${reason})`)
        .toBeGreaterThanOrEqual(members!.length < COPY_MINIMUM ? members!.length : Math.max(COPY_MINIMUM, Math.ceil(members!.length * COPY_RATIO)));
    }
  });
});

/**
 * A value set is not the only shape a copy takes. One string can be a contract too.
 *
 * `FINAL_VIDEO_RELATIVE_PATH` had ten homes when it was collapsed on 2026-09-06 — five in the backend, four in
 * the frontend, and the contract's own two response fields, which type the field as this exact string. Two of
 * the frontend copies sit inside response guards: a rename would not have failed loudly, it would have made
 * finished videos stop being recognised as finished.
 *
 * Only path-shaped values are watched, because a path is the kind of constant that gets retyped rather than
 * imported — and the parser is checked below, so a contract reorganised out from under it fails instead of
 * quietly finding nothing.
 */
describe("a contract's single-value constants are named once", () => {
  async function contractPaths(): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const file of await collectSourceFiles(SHARED_SOURCE)) {
      const source = await fs.readFile(file, "utf8");
      // Path-shaped or code-shaped: the two kinds that get retyped rather than imported. A screaming-snake
      // value is an error code, and the one that prompted this had seven spellings of itself.
      for (const match of source.matchAll(/export const ([A-Z][A-Z0-9_]*) = "([^"]*)"/g)) {
        if (match[2]!.includes("/") || /^[A-Z][A-Z0-9_]{4,}$/.test(match[2]!)) found.set(match[1]!, match[2]!);
      }
    }
    return found;
  }

  it("finds the constants it is supposed to be watching", async () => {
    expect([...(await contractPaths()).keys()]).toEqual(expect.arrayContaining(["FINAL_VIDEO_RELATIVE_PATH", "BUDGET_LEDGER_UNREADABLE_CODE"]));
  });

  it("has no source file retyping one of them", async () => {
    const paths = await contractPaths();
    const offenders: string[] = [];
    for (const file of await collectSourceFiles(FRONTEND_SOURCE)) {
      // Union members are skipped, and only they: a `type Code = ... | "SOME_CODE"` line is checked by the
      // compiler already — the factory passes the constant into a constructor typed by that union, so a value
      // the union no longer contains does not build. What is unguarded is a factory writing the bare string.
      const source = (await fs.readFile(file, "utf8")).split(String.fromCharCode(10)).filter((line) => !line.includes("|")).join(String.fromCharCode(10));
      for (const [name, value] of paths) {
        if (source.includes(`"${value}"`)) offenders.push(`${path.relative(FRONTEND_SOURCE, file)} writes out ${name}'s value — import ${name} instead`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
