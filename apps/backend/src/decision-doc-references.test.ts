import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Repo-wide guard: every `D-###` reference in source must resolve to a real entry in docs/06_DECISIONS.md.
 *
 * This exists because the problem it guards against already happened silently. Source comments across every
 * workspace pointed at `.claude-bridge/` round numbers for their rationale, but that folder is gitignored — so
 * for anyone who cloned the repo those pointers led nowhere, and nothing caught it while the count grew past
 * eighty. A pointer to an explanation is worth less than no pointer at all when the explanation is unreachable,
 * because it stops the reader from looking elsewhere.
 *
 * Scans the whole repository rather than just this workspace, which is why it sits at the root of
 * apps/backend/src rather than beside any one feature: this workspace's suite is the one that runs in every
 * verification pass, and the repo has no root-level test runner to host it. Its scope is the repo, not backend.
 */

const CURRENT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(CURRENT_DIRECTORY, "../../..");
const DECISIONS_DOC = path.join(REPOSITORY_ROOT, "docs", "06_DECISIONS.md");

/** Source roots whose comments may cite a decision. Kept explicit rather than globbing the repo so build output, node_modules and generated bundles can never be scanned. */
const SOURCE_ROOTS = [
  path.join(REPOSITORY_ROOT, "apps", "backend", "src"),
  path.join(REPOSITORY_ROOT, "apps", "frontend", "src"),
  path.join(REPOSITORY_ROOT, "apps", "desktop", "src"),
  path.join(REPOSITORY_ROOT, "packages", "shared", "src"),
];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const REFERENCE_PATTERN = /\bD-(\d{3})\b/g;
/** Only `### D-007 · title` headings define an ID. A mention anywhere else in the doc (prose, a heading shown as an example) must not count as a definition. */
const HEADING_PATTERN = /^###\s+(D-\d{3})\b/;

/**
 * A `###` line inside a fenced code block is an illustration of the format, not a definition of an entry — the
 * document's own rules section shows the heading shape that way. Counting those made the very first run of this
 * guard report the rules section's example as a duplicate of a real entry.
 */
function headingLinesOutsideCodeFences(document: string): string[] {
  let insideFence = false;
  return document.split(/\r?\n/).filter((line) => {
    if (/^\s*```/.test(line)) { insideFence = !insideFence; return false; }
    return !insideFence;
  });
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  // Dirent<string>, not the Buffer-named overload the bare ReturnType resolves to — `withFileTypes: true`
  // is what this call actually asks for.
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return []; // A workspace that does not exist in this checkout is not a failure of this guard.
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...await collectSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

interface Reference { id: string; file: string; line: number }

async function collectReferences(): Promise<Reference[]> {
  const files = (await Promise.all(SOURCE_ROOTS.map(collectSourceFiles))).flat();
  const references: Reference[] = [];
  for (const file of files) {
    if (file === THIS_FILE) continue; // this file's own pattern literals
    const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const match of text.matchAll(REFERENCE_PATTERN)) {
        references.push({ id: `D-${match[1]}`, file: path.relative(REPOSITORY_ROOT, file), line: index + 1 });
      }
    });
  }
  return references;
}

async function collectDefinedIds(): Promise<string[]> {
  const document = await fs.readFile(DECISIONS_DOC, "utf8");
  return headingLinesOutsideCodeFences(document)
    .map((line) => HEADING_PATTERN.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
}

describe("decision document references", () => {
  it("defines every D-### id exactly once", async () => {
    const ids = await collectDefinedIds();
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    // A duplicated id silently makes one of the two entries unreachable — a reader following a reference lands
    // on whichever comes first and never learns the other exists.
    expect([...new Set(duplicates)]).toEqual([]);
  });

  it("resolves every D-### reference in source to a defined entry", async () => {
    const [references, ids] = await Promise.all([collectReferences(), collectDefinedIds()]);
    const defined = new Set(ids);
    const dangling = references.filter((reference) => !defined.has(reference.id));
    // Reported as file:line so a failure names the comment to fix rather than only the missing id.
    expect(dangling.map((reference) => `${reference.file}:${reference.line} -> ${reference.id}`)).toEqual([]);
  });

  it("treats a heading inside a code fence as an example, not a definition", () => {
    const document = [
      "```markdown", "### D-000 · shown as an example", "```",
      "### D-001 · a real entry",
    ].join("\n");
    expect(headingLinesOutsideCodeFences(document).map((line) => HEADING_PATTERN.exec(line)?.[1]).filter(Boolean))
      .toEqual(["D-001"]);
  });

  it("has no source comment left pointing at the uncommitted mailbox", async () => {
    // The lock this whole exercise was working toward. Every rationale that used to live behind a round number
    // is now either in the decision document or written out in the comment itself, so a new pointer at the
    // gitignored mailbox can only recreate the gap — and unlike last time, it cannot accumulate unnoticed.
    const files = (await Promise.all(SOURCE_ROOTS.map(collectSourceFiles))).flat();
    const offenders: string[] = [];
    for (const file of files) {
      if (file === THIS_FILE) continue; // the check may name what it forbids
      const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
      lines.forEach((text, index) => {
        if (text.includes(".claude-bridge")) offenders.push(`${path.relative(REPOSITORY_ROOT, file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("scans every workspace, not just this one", async () => {
    // Guards the guard: if SOURCE_ROOTS ever stops covering a workspace, dangling references there would pass
    // unnoticed — the exact silent-gap shape this whole check exists to close.
    const files = (await Promise.all(SOURCE_ROOTS.map(collectSourceFiles))).flat();
    const scanned = new Set(files.map((file) => path.relative(REPOSITORY_ROOT, file).split(path.sep).slice(0, 2).join("/")));
    expect([...scanned].sort()).toEqual(["apps/backend", "apps/desktop", "apps/frontend", "packages/shared"]);
  });
});
