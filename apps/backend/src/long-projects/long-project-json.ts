import * as fs from "node:fs/promises";

import { longMalformed, longNotFound, longStorageError } from "./long-project-api.error.js";

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
