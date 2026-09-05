import * as fs from "node:fs/promises";

import { longEpisodeNotFound, longMalformed, longNotFound, longStorageError } from "./long-project-api.error.js";

/**
 * Reads one of a long project's JSON files, and decides which failure a person is told about.
 *
 * Eleven services carried this same try/catch — nine as a private `json`, one as `readJson`, one inline. It is
 * not plumbing: the three branches are three different sentences on screen, and which one a file gets is a
 * product decision.
 *
 * - **ENOENT is "not found", not a failure.** A file that was never written is an ordinary state in this app —
 *   an Episode with no script yet has no per-episode `project.json` at all. Callers that can distinguish
 *   further catch this and say something better (episode-narration turns it into "no script yet"); the ones
 *   that cannot at least do not report a missing file as a broken disk.
 * - **A SyntaxError is the file's fault, not the disk's.** Reporting it as a storage error sends someone to
 *   check permissions and free space for a file that is right there and readable.
 * - **Anything else is storage.** Deliberately last: an unknown failure must not be quietly filed under one of
 *   the two specific answers above.
 *
 * Eleven copies of that agreed today. What they could not survive is one of them being adjusted — a single
 * service reporting a missing Episode as a storage failure would look, on that one screen, exactly like a disk
 * going bad, while every other screen said the project was fine.
 */
export async function readLongProjectJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound();
    if (error instanceof SyntaxError) throw longMalformed();
    throw longStorageError();
  }
}

/**
 * Refuses an Episode number this project's outline does not list.
 *
 * Six services asked this question and each wrote out the same four conditions. It is the answer to "does
 * Episode 7 exist", and a copy that softens one condition does not fail — it opens an Episode the other five
 * refuse, or refuses one they open, on one screen only.
 *
 * `episode_number !== number` is the condition that looks redundant and is not: the outline is a list, and
 * position and stored number agreeing is what makes "the seventh entry" and "Episode 7" the same thing. An
 * outline written with a gap would otherwise hand back a neighbour's Episode under the number asked for.
 *
 * Takes the outline file rather than its contents so that the read and the refusal cannot be separated by a
 * caller — reading it and forgetting to check is the shape this replaces.
 */
export async function assertEpisodeListed(outlinesFile: string, number: number): Promise<void> {
  if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound();
  const outlines = await readLongProjectJson(outlinesFile);
  const listed = Array.isArray(outlines) ? outlines[number - 1] : undefined;
  if (!Array.isArray(outlines) || number > outlines.length
    || typeof listed !== "object" || listed === null || Array.isArray(listed)
    || (listed as { episode_number?: unknown }).episode_number !== number) throw longEpisodeNotFound();
}
