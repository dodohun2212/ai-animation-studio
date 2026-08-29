import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Repo-wide guard: the tests that stand between a person and a wasted paid request must still exist.
 *
 * A deleted guard is caught by its own test going red. A deleted guard *and its test* is caught by nothing —
 * the suite passes with fewer tests, and a smaller number reads exactly like a bigger one. That happened three
 * times in one day here: a file came back from a stale copy carrying an older version of itself, and with it
 * went the scene-count lock tests and the mapping scene-choice tests. Both times the loss was found by a person
 * reading a diff, which is not a control.
 *
 * So this pins the titles by name. It cannot check that a test still asserts anything useful — a test can be
 * gutted and keep its name — but it does make disappearance loud, and disappearance is the failure mode that
 * has actually occurred.
 *
 * What belongs on this list: a test whose absence lets money leave, or lets work already paid for be lost or
 * overwritten. Not "important" tests — the list stops being read if it grows into a second suite. Removing an
 * entry is a deliberate act: delete it here in the same commit, so the removal appears in a diff someone reads.
 */
const MONEY_GUARDS: readonly { title: string; why: string }[] = [
  {
    title: "does not offer approval again for an outline that is already approved",
    why: "one project was billed twice for the same outline; the screen must not re-arm the button",
  },
  {
    title: "locks the scene count and says why once the Story exists",
    why: "changing it after the Story leaves the project unable to continue, with paid scenes stranded",
  },
  {
    title: "locks the aspect ratio and says why once images exist",
    why: "portrait images sent for landscape video, then padded by the merge — all paid, none matching",
  },
  {
    title: "buys only the failed scene when a retry follows three that already succeeded",
    why: "$0.25 a scene, on the button pressed immediately after an error",
  },
  {
    title: "never double-submits the same scene when two independent service instances race",
    why: "the shape of a nest-watch restart: two processes, one scene, two charges",
  },
  {
    title: "refuses to drop an Episode that has been worked on, rather than losing what was paid for",
    why: "its script and images stay on disk with nothing pointing at them",
  },
  {
    title: "writes what Runway sent, not the local placeholder",
    why: "six clips were charged for and their bytes thrown away, with every check still reading green",
  },
  {
    title: "fetches the clips already paid for instead of buying them again",
    why: "recovery must stay a read — losing it means paying a second time for work already done",
  },
  {
    // One title, two suites: the short project's merge and the Episode's. They had the same hole for the same
    // reason, and a list that pinned only one of them would say the pair was covered.
    title: "refuses to merge a paid run whose clips are placeholders, while the local fake path still merges",
    why: "stubs would be published as the final video, and costing nothing is what makes that easy to believe",
  },
  {
    title: "restores the Episode's existing video job on mount, so a reload does not strand paid work",
    why: "without it a refresh hid the review cards, the players and the recovery button behind a job the page no longer had",
  },
  {
    title: "plays the finished Episode, and still does so after a reload that lost the merge response",
    why: "the same shape one level up — a finished video with no address left anywhere in the app",
  },
  {
    title: "reaches its own route, writes the downloaded bytes over the stubs, and never asks Runway to make anything",
    why: "recovery is a download; the moment it creates a task instead it costs $0.25 a scene to fetch what was already bought",
  },
  {
    title: "makes an older copy current again, archiving the one it displaces so the restore is reversible",
    why: "without the archive-first step a restore silently destroys the paid clip it replaces, and nothing else keeps a copy",
  },
  {
    title: "still serves a scene clip after the Episode has been merged, rather than reading the finished Episode as corrupt",
    why: "three services rejected the completed state, so merging put every scene player and the recovery button behind a 500",
  },
  {
    title: "does not count a paid Episode's placeholders as ready videos, while a local fake run still lists them",
    why: "the library reporting a stubbed batch as finished is the report that made six thrown-away clips look fine",
  },
  {
    // One title, two suites again: the short project's scene content route and its final-video route.
    title: "refuses to serve a paid run's placeholder as a scene, but still serves the same file for a local fake run",
    why: "a player handed a 32-byte header draws a black box that claims to be the paid clip — the claim that got six stubs approved",
  },
];

describe("paid-work guard tests", () => {
  it("still contains every test named as standing between a person and a wasted charge", async () => {
    const selfPath = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(selfPath), "../../..");
    const sources: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full);
        // Skipping this file is not tidiness: every title below is a string literal here, so a scan that
        // included it would match itself and pass no matter what was deleted. Injecting a rename proved that —
        // the first version of this guard was green with the lock test already gone.
        else if (/\.test\.tsx?$/.test(entry.name) && full !== selfPath) sources.push(await fs.readFile(full, "utf8"));
      }
    };
    for (const workspace of ["apps", "packages"]) await walk(path.join(repoRoot, workspace));
    // Proof the walk found the suites rather than silently matching nothing — the failure this guard exists to
    // prevent is a check that quietly stops looking.
    expect(sources.length).toBeGreaterThan(100);

    const all = sources.join("\n");
    const missing = MONEY_GUARDS.filter(({ title }) => !all.includes(title)).map(({ title, why }) => `${title} — ${why}`);
    expect(missing).toEqual([]);
  });
});
