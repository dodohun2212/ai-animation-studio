import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Repo-wide guard: an error code and the sentence a person reads for it must be able to find each other.
 *
 * Every refusal in this app is two halves in two workspaces. The backend picks a code, and a map in
 * `apps/frontend/src/api` turns that code into the one sentence the person actually sees — the backend's own
 * English message never reaches anyone. So a code with no entry falls through to a catch-all like
 * 「요청을 처리하지 못했습니다」, and an entry whose code nothing throws is a sentence that can never appear.
 * Both halves typecheck perfectly, both look right when read on their own, and neither can see the other.
 *
 * Not hypothetical, and not rare. Found by hand on 2026-09-08, all in one sweep:
 *
 *   LONG_EPISODE_CONTINUITY_INVALID   the screen's sentence existed; nothing threw the code
 *   INSTAGRAM_PUBLISH_IN_PROGRESS     "do not press again" — on the one action that cannot be undone
 *   VIDEO_RETRY_NEEDS_CHANGED_INPUT   the guard built after 2026-09-05 charged $0.25 twice
 *
 * The last two are the shape that costs money: the app knows exactly what happened and says the sentence that
 * means "something went wrong", which reads as "try again". docs/06_DECISIONS.md D-010 is this same reasoning
 * about paid retries; this is it about refusals in general.
 *
 * And it had already been found once, by hand, in one place. `audioLibraryApi.ts`'s own comment records a table
 * that listed three codes the backend never sends while missing the two it does, so every refused upload fell
 * through to 「요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.」 — wrong twice over, as that comment puts
 * it: it names no cause and it recommends a retry for a file that will be refused identically every time. That
 * fix was correct and local. Nothing stopped the same thing being true of the eleven other codes below.
 *
 * Deliberately lenient about what counts as reaching: any exact mention of the code in non-test frontend
 * source. A coincidental match makes the guard weaker, never wrong, and the failure worth catching is a code
 * named nowhere at all. Exact, though — matching loosely is how this was mis-verified the first time round,
 * because `VIDEO_RESTORE_NOT_ALLOWED` is a substring of `LONG_EPISODE_VIDEO_RESTORE_NOT_ALLOWED` and a plain
 * `includes` reported a dead entry as a live one.
 *
 * Lives at the root of apps/backend/src for the reason decision-doc-references.test.ts gives: its scope is the
 * repo, and this workspace's suite is the one that runs in every verification pass.
 *
 * 🔴 This shipped blind to one module of seventeen. The first version read `*-api.error.ts`, and
 * `settings/provider-settings.error.ts` does not carry the `api` — so every provider-settings code was
 * invisible in both directions while the guard reported green, and widening the filter immediately surfaced a
 * tenth unreachable code. A guard is also a claim about its own coverage, and that claim is the part nothing
 * else checks: the count assertions below are there so a collector that quietly stops finding things fails
 * instead of passing.
 */

const CURRENT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const REPOSITORY_ROOT = path.resolve(CURRENT_DIRECTORY, "../../..");
const BACKEND_SOURCE = path.join(REPOSITORY_ROOT, "apps", "backend", "src");
const FRONTEND_SOURCE = path.join(REPOSITORY_ROOT, "apps", "frontend", "src");
const FRONTEND_API = path.join(FRONTEND_SOURCE, "api");

/**
 * Codes no screen names, each with the reason — and where the reason is a gap rather than a decision, that is
 * what it says. Same shape and same rule as apps/frontend's own ALLOWED lists: an entry that has stopped
 * applying fails instead of sitting here quietly.
 */
const UNNAMED_BY_A_SCREEN = new Map<string, string>([
  // 🔴 Gap, found when this guard's filter was widened to every `*.error.ts`: a video model the app cannot
  // price is refused here, and the settings screen has no sentence for it. Reported to Cowork (CLI Round 651).
  ["UNKNOWN_VIDEO_MODEL", "🔴 gap: 「고를 수 없는 영상 모델입니다」 exists in the backend and reaches nobody"],
  // 🟠 Decisions — and the reasons were rewritten on 2026-09-08 after being checked, because all three were
  // written from memory and all three were wrong in their wording. One was wrong in substance. An exception's
  // reason is the only thing standing between it and being deleted by the next person, so a reason nobody
  // measured is worse than no entry at all: it is trusted, and it was here for hours with Cowork agreeing to it.
  //
  // What the catch-all actually says, checked rather than recalled, is 「요청을 처리하지 못했습니다. 잠시 후
  // 다시 시도해 주세요」 — that is a recommendation, not just a report, which is the part the first version of
  // these reasons left out.
  //
  // A retry is a fair recommendation for these two: a failed write here is most often a transient lock, and
  // atomic-file.ts already retries EPERM/EBUSY/EACCES for exactly the antivirus and OneDrive cases before
  // giving up. So the sentence is right by luck of the domain, not because the failure is unspeakable.
  ["VIDEO_LIBRARY_STORAGE_ERROR", "write failure; the catch-all's 「잠시 후 다시 시도」 is apt because these are usually transient locks"],
  ["STORY_PROMPT_STORAGE_ERROR", "write failure — same, and the same reason"],
  // 🔴 The one that was wrong. This is not "local fake-mode only": it is the fallback arm of a catch, so an
  // unexpected error on the *paid* path lands here too. It stays an exception on the corrected reasoning that
  // every known failure of the real path is mapped before it — budget ledger, budget exceeded, and the
  // provider's own error — leaving this as a genuine unknown, which is what a catch-all is for. The backend's
  // own message still says "Local Story generation…", which is the same overstatement in a second place; it
  // reaches no screen, so it misleads only the next reader, and it is left for a round that changes that file.
  ["STORY_GENERATION_FAILED", "the fallback arm for an unexpected error; every known failure of the paid path is mapped before it"],
]);

/**
 * Sentences whose code nothing throws, same rules.
 *
 * Empty, and it took one round to get here: the two entries this held were `VIDEO_RESTORE_NOT_ALLOWED` and
 * `VIDEO_VERSION_NOT_FOUND`, the screen's names for codes the backend calls `VIDEO_LIBRARY_…`. Renaming the
 * keys on the screen's side cleared these two and two more above, which is what being the same defect seen
 * from both ends means.
 */
const REACHING_NOTHING = new Map<string, string>();

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

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
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.includes(".test.")) files.push(full);
  }
  return files;
}

/**
 * Every code the backend declares it can answer with.
 *
 * Read off the `type …Code… = "A" | "B"` unions in the `*-api.error.ts` files rather than off the throw sites,
 * because the union is the list each module maintains as its contract — a factory that builds its code from a
 * variable is invisible to a throw-site scan, and that is exactly the miss which made the first hand-run of
 * this sweep report eight false candidates.
 */
async function declaredBackendCodes(): Promise<Map<string, string>> {
  const codes = new Map<string, string>();
  for (const file of await collectSourceFiles(BACKEND_SOURCE)) {
    // Every `*.error.ts`, not just `*-api.error.ts`. One module of seventeen — `settings/provider-settings.error.ts`
    // — does not carry the `api` in its name, and filtering on that spelling made this guard blind to it in
    // both directions while reporting green. A filter narrower than the thing it is filtering for is how a
    // guard says nothing convincingly.
    if (!file.endsWith(".error.ts")) continue;
    const source = await fs.readFile(file, "utf8");
    for (const union of source.matchAll(/type \w*Code\w* =([^;]+);/g)) {
      for (const code of union[1]!.matchAll(/"([A-Z][A-Z0-9_]{3,})"/g)) {
        if (!codes.has(code[1]!)) codes.set(code[1]!, path.basename(file));
      }
    }
  }
  return codes;
}

/** The keys of the code→sentence maps: a SCREAMING_CASE key with a string literal after it, in the API layer. */
async function frontendMappedCodes(): Promise<Map<string, string>> {
  const codes = new Map<string, string>();
  for (const file of await collectSourceFiles(FRONTEND_API)) {
    const source = await fs.readFile(file, "utf8");
    for (const entry of source.matchAll(/^\s{2}([A-Z][A-Z0-9_]{3,}):\s*[`"]/gm)) {
      if (!codes.has(entry[1]!)) codes.set(entry[1]!, path.basename(file));
    }
  }
  return codes;
}

/** Exact, never a substring — see the file comment for the mis-verification that makes this the whole point. */
function names(source: string, code: string): boolean {
  return new RegExp(`(?<![A-Z0-9_])${code}(?![A-Z0-9_])`).test(source);
}

async function frontendText(): Promise<string> {
  const files = await collectSourceFiles(FRONTEND_SOURCE);
  // Well under the real count, so deleting a few files is not a red suite, and far enough above zero that a
  // collector which stopped finding anything cannot pass by finding every code unreachable.
  expect(files.length).toBeGreaterThan(70);
  return (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n");
}

describe("an error code and the sentence a person reads for it can find each other", () => {
  it("finds the two lists it is supposed to be comparing", async () => {
    const declared = await declaredBackendCodes();
    const mapped = await frontendMappedCodes();

    // A floor, not a tuned number: it catches a collector that has stopped finding things, but it would not
    // have caught the `*-api.error.ts` filter, which hid one module and still left well over a hundred codes.
    expect(declared.size).toBeGreaterThan(150);
    expect(mapped.size).toBeGreaterThan(100);
    // Specimens, because a count cannot say *which* things were found. The first two are ordinary; the third
    // is from `settings/provider-settings.error.ts`, the module the original filter spelled its way past — so
    // narrowing the filter again fails here by name rather than by an arithmetic that still looks healthy.
    expect(declared.has("INSTAGRAM_ALREADY_PUBLISHED")).toBe(true);
    expect(declared.has("INSTAGRAM_PUBLISH_IN_PROGRESS")).toBe(true);
    expect(declared.has("SETTINGS_STORAGE_ERROR")).toBe(true);
    expect(mapped.has("INSTAGRAM_ALREADY_PUBLISHED")).toBe(true);
  });

  it("has no backend code that no screen can say anything about", async () => {
    const declared = await declaredBackendCodes();
    const source = await frontendText();

    const unreachable = [...declared.keys()]
      .filter((code) => !names(source, code))
      .filter((code) => !UNNAMED_BY_A_SCREEN.has(code))
      .sort();
    expect(unreachable).toEqual([]);
  });

  it("has no screen sentence whose code nothing can throw", async () => {
    const declared = await declaredBackendCodes();
    const mapped = await frontendMappedCodes();
    const backendText = (await Promise.all(
      (await collectSourceFiles(BACKEND_SOURCE)).map((file) => fs.readFile(file, "utf8")),
    )).join("\n");

    const stranded = [...mapped.keys()]
      .filter((code) => !declared.has(code) && !names(backendText, code))
      // Client-side codes are minted by the frontend itself for network and parse failures, so no backend
      // module declares them and none should.
      .filter((code) => !code.startsWith("CLIENT_"))
      .filter((code) => !REACHING_NOTHING.has(code))
      .sort();
    expect(stranded).toEqual([]);
  });

  it("keeps only exceptions that are still true, so one cannot outlive its reason", async () => {
    const declared = await declaredBackendCodes();
    const source = await frontendText();

    for (const [code, reason] of UNNAMED_BY_A_SCREEN) {
      expect(declared.has(code), `${code} is no longer a declared backend code — drop the exception (${reason})`).toBe(true);
      expect(names(source, code), `${code} is named by a screen now — drop the exception (${reason})`).toBe(false);
    }
    for (const [code, reason] of REACHING_NOTHING) {
      expect(declared.has(code), `${code} is thrown now — drop the exception (${reason})`).toBe(false);
    }
  });
});
