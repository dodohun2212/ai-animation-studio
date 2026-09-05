import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Repo-wide guard: nothing sends a billed provider request without first asking the Budget whether it may.
 *
 * This is the rule the whole money side rests on, and until now nothing held it. Every existing check tests one
 * service's behaviour, so a *new* paid call site added tomorrow — a new screen, a new pipeline — could reach a
 * provider with no preflight at all and every suite would stay green. That is the same failure as
 * docs/06_DECISIONS.md D-039, one level up: the rules were real, but only where someone had remembered to
 * write them down for a particular file.
 *
 * Two halves, and the second is what keeps the first honest.
 *
 * 1. Every file that calls a billed adapter function must also call `preflight`.
 * 2. Every function the adapters export must be classified below as billed or not. A new adapter function
 *    therefore fails this test until someone says which it is, instead of quietly falling outside the first
 *    half's list — a hand-kept list of "the paid calls" is exactly the thing that goes stale.
 *
 * Scoped to the two providers that have a monthly budget. Instagram's Graph client is not here: publishing is
 * not metered against a ledger, so "preflight" would have nothing to ask.
 */

const CURRENT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const BACKEND_SOURCE = path.resolve(CURRENT_DIRECTORY, "..");

/** The adapter modules that hold a network client for a budgeted provider. */
const ADAPTERS = [
  "images/openai-image-adapter.ts",
  "narration/openai-narration-adapter.ts",
  "story/openai-story-adapter.ts",
  "long-projects/openai-episode-planner-adapter.ts",
  "videos/runway-video-adapter.ts",
];

/** Calling one of these spends money. A caller must preflight first. */
const BILLED = new Set([
  "callOpenAiImageApi",
  "callOpenAiImageEditApi",
  "callOpenAiTtsApi",
  "callOpenAiStoryApi",
  "callOpenAiEpisodePlannerApi",
  "createRunwayImageToVideoTask",
]);

/**
 * These reach the provider but are not billed: the task they ask about was paid for when it was created, and
 * asking how it is going — or fetching the output it already produced — costs nothing more. Requiring a
 * preflight here would be worse than useless, because it would refuse to collect work the month has already
 * been charged for whenever the budget happened to be spent (docs/06_DECISIONS.md D-037).
 */
//  reads a code this app already has and returns what to do about it — no request, no
// money. Listed rather than exempted so a later export that does spend cannot slip in beside it.
const NOT_BILLED = new Set(["getRunwayTask", "downloadRunwayOutput", "runwayFailureOutcome"]);

/**
 * The file without its whole-line comments.
 *
 * A doc comment that *names* a paid call is not a paid call: `instagram-graph-adapter.ts` cites
 * `createRunwayImageToVideoTask()` while explaining that it applies the same rule to its own requests, and the
 * first run of this guard reported it as an unguarded caller. Only lines that are entirely comment are dropped —
 * a line of real code never is — so this can never hide a call by stripping too much.
 */
function withoutCommentLines(source: string): string {
  return source.split("\n").filter((line) => {
    const trimmed = line.trimStart();
    return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
  }).join("\n");
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

describe("budget preflight coverage", () => {
  it("classifies every adapter export as billed or not billed", async () => {
    for (const adapter of ADAPTERS) {
      const source = await fs.readFile(path.join(BACKEND_SOURCE, adapter), "utf8");
      const exported = [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]!);
      expect(exported.length, adapter).toBeGreaterThan(0);
      for (const name of exported) {
        expect(BILLED.has(name) || NOT_BILLED.has(name), `${adapter} exports ${name}, which is neither listed as billed nor as not billed`).toBe(true);
      }
    }
  });

  it("preflights the budget in every file that calls a billed provider request", async () => {
    const adapterPaths = new Set(ADAPTERS.map((relative) => path.join(BACKEND_SOURCE, relative)));
    const files = (await collectSourceFiles(BACKEND_SOURCE)).filter((file) => !adapterPaths.has(file));

    const callers: string[] = [];
    for (const file of files) {
      const source = withoutCommentLines(await fs.readFile(file, "utf8"));
      const calls = [...BILLED].filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(source));
      if (calls.length === 0) continue;
      callers.push(path.relative(BACKEND_SOURCE, file).replaceAll(path.sep, "/"));
      expect(/\bpreflight\s*\(/.test(source), `${path.relative(BACKEND_SOURCE, file)} calls ${calls.join(", ")} without any budget preflight`).toBe(true);
    }

    // The sweep found real call sites rather than passing on an empty set — the way a guard that has quietly
    // stopped matching anything would.
    expect(callers.length).toBeGreaterThan(5);
  });
});
