import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Repo-wide guard: durable JSON state is written atomically, never with a plain write.
 *
 * A plain write truncates the file first and fills it after. Interrupted in between — the process killed, the
 * machine losing power, `nest start --watch` restarting mid-save — it leaves a half-written file that parses as
 * nothing. Every one of these files is something a person cannot reconstruct: the spend ledger, the asset index,
 * a project's own record of what has been generated and paid for.
 *
 * Cross-referencing the rule against its actual use found it already kept everywhere. This guard is what keeps
 * that true for the file someone adds next, which is the half that D-039 showed does not hold on its own.
 *
 * The two exceptions are both deliberate and both are the point of the file they live in.
 */
const ALLOWED = new Map<string, string>([
  // The helper itself: this is where temp-write-then-rename is implemented.
  ["projects/atomic-file.ts", "implements the atomic write"],
  // The lock's whole mechanism is an exclusive `wx` create, which an atomic rename would defeat: rename
  // overwrites, and a lock that can be taken by overwriting is not a lock.
  ["videos/project-lock.ts", "an exclusive create is the lock"],
]);

const CURRENT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const BACKEND_SOURCE = path.resolve(CURRENT_DIRECTORY, "..");

/** Whole-line comments only — a line of real code never is one, so this cannot hide a write. */
function codeLines(source: string): string[] {
  return source.split("\n").filter((line) => {
    const trimmed = line.trimStart();
    return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
  });
}

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

describe("durable state is written atomically", () => {
  it("writes no JSON state through a plain writeFile outside the two files that must", async () => {
    const files = await collectSourceFiles(BACKEND_SOURCE);
    expect(files.length).toBeGreaterThan(50);

    let checked = 0;
    for (const file of files) {
      const relative = path.relative(BACKEND_SOURCE, file).replaceAll(path.sep, "/");
      const source = await fs.readFile(file, "utf8");
      for (const line of codeLines(source)) {
        // A JSON payload or a .json destination is what makes a write "durable state" rather than media bytes,
        // which have their own integrity checks (a probe, a PNG validation) right after they are written.
        if (!/\bwriteFile\s*\(/.test(line)) continue;
        if (/atomicWriteUtf8File\s*\(/.test(line)) continue;
        if (!line.includes(".json") && !line.includes("JSON.stringify")) continue;
        checked += 1;
        expect(ALLOWED.has(relative), `${relative} writes JSON state with a plain writeFile: ${line.trim()}`).toBe(true);
      }
    }

    // The sweep is matching real lines rather than passing because its pattern stopped finding anything.
    expect(checked).toBeGreaterThan(0);
  });

  it("names only exceptions that still exist, so the list cannot outlive its reasons", async () => {
    for (const [relative, reason] of ALLOWED) {
      const source = await fs.readFile(path.join(BACKEND_SOURCE, relative), "utf8").catch(() => null);
      expect(source, `${relative} is allowed to write JSON directly (${reason}) but no longer exists`).not.toBeNull();
      expect(codeLines(source!).some((line) => /\bwriteFile\s*\(/.test(line)), `${relative} is on the exception list (${reason}) but no longer writes anything`).toBe(true);
    }
  });
});
