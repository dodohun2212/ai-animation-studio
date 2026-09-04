import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * An optional field the contract declares and no screen ever reads.
 *
 * Required fields are the compiler's job: drop one and the build stops. Optional fields are nobody's — they are
 * how `instagramPostAt` and `thumbOffsetMs` went missing without a word, and they are how a field can be added,
 * filled in by the server, and simply never arrive anywhere a person can see it.
 *
 * That is not hypothetical either. Running this by hand on 2026-09-05 found `unavailableReason`: the continuity
 * check had been split into three reasons weeks earlier, the server had been sending which of the three all
 * along, and the screen was restating one of them for all three — two of those statements being false. Nothing
 * failed, because nothing was looking.
 *
 * Deliberately lenient about what counts as "read": any mention of the name in a non-test frontend source. A
 * coincidental match makes this guard weaker, never wrong, and the failure it exists to catch is a field
 * mentioned nowhere at all.
 */
const CURRENT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SOURCE = CURRENT_DIRECTORY;
const SHARED_SOURCE = path.resolve(CURRENT_DIRECTORY, "..", "..", "..", "packages", "shared", "src");

/**
 * Fields no screen reads on purpose, each with the reason — and, where the reason is a gap rather than a
 * decision, that is what it says. Same shape as the other exception lists in this repository, and checked the
 * same way: an entry that has stopped applying fails instead of sitting there.
 */
const ALLOWED = new Map<string, string>([
  // ProviderTaskRecord is a backend-internal record shape that happens to live in the shared package. It is
  // never part of a response, so no screen can read this and none should.
  ["completedAt", "a field of ProviderTaskRecord, which is storage rather than a response"],
  // The mapper's own comment names a consumer for script, motionPrompt and generatedImagePath. It names none
  // for this one, and there is none: screens play a clip through its content URL, never through a path.
  ["generatedVideoPath", "screens play clips by content URL; no screen wants a path"],
  // A gap, not a decision: the short project's merge screen has an open-the-folder button and the Episode's
  // only prints the path. openablePath is the field that button would need. Reported in Round 507.
  ["openablePath", "the Episode merge screen has no open-the-folder button yet"],
  // Also gaps: the server honours both and applies documented defaults, and no control offers either.
  ["volume", "the merge audio panel offers no volume control yet"],
  ["fadeSeconds", "the merge audio panel offers no fade control yet"],
]);

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

/** Every `name?: ` declared at one level of indentation in the contract — its optional interface fields. */
async function optionalContractFields(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const file of await collectSourceFiles(SHARED_SOURCE)) {
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\?: /gm)) names.add(match[1]!);
  }
  return names;
}

async function frontendText(): Promise<string> {
  const files = await collectSourceFiles(FRONTEND_SOURCE);
  // Well under the real count so deleting a few files is not a red suite, and far enough above zero that a
  // collector which stopped finding anything cannot pass by finding every field unread.
  expect(files.length).toBeGreaterThan(70);
  return (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n");
}

describe("optional contract fields reach a screen", () => {
  it("finds the fields it is supposed to be watching", async () => {
    const fields = await optionalContractFields();
    expect(fields.size).toBeGreaterThan(80);
    expect(fields).toContain("unavailableReason");
  });

  it("has no optional field that no screen reads", async () => {
    const fields = await optionalContractFields();
    const source = await frontendText();
    const unread = [...fields]
      // A plain substring, deliberately: a word-boundary regex here is an escaping trap for no benefit, and this
      // check wants to be lenient — a coincidental match only weakens it, while a missed one is a false alarm.
      .filter((name) => !source.includes(name))
      .filter((name) => !ALLOWED.has(name))
      .sort();
    expect(unread).toEqual([]);
  });

  it("names only exceptions that are still unread, so one cannot outlive its reason", async () => {
    const fields = await optionalContractFields();
    const source = await frontendText();
    for (const [name, reason] of ALLOWED) {
      expect(fields, `${name} is no longer an optional contract field — drop the exception (${reason})`).toContain(name);
      expect(source.includes(name), `${name} is read now — drop the exception (${reason})`).toBe(false);
    }
  });
});
