import * as fs from "node:fs/promises";
import { withWarning } from "../projects/warnings.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";

/**
 * Appending a plain-language warning to an Episode in memory.
 *
 * A stored Episode is a loose record rather than a typed object, so every writer had been re-deriving the same
 * three steps: read the array defensively, refuse to stack the same sentence twice, write it back. Written once
 * here because the second of those is easy to leave out, and leaving it out is invisible until an Episode's
 * screen is showing the same sentence six times.
 */
export function appendEpisodeWarning(episode: Record<string, unknown>, message: string): void {
  const existing = Array.isArray(episode.warnings) ? episode.warnings.filter((item): item is string => typeof item === "string") : [];
  episode.warnings = withWarning(existing, message);
}

/**
 * Puts a warning in both places an Episode's warnings are read from: its own record, and its row in the outline
 * list. `orphaned-episode-generation-recovery.service.ts` writes to both for the same reason — an Episode's
 * detail screen and the list that links to it are two separate reads, and a warning on only one of them is
 * invisible from the other.
 *
 * Never throws. Every caller is either on a path that has already succeeded or on one that is already failing
 * for a different reason, and losing the note must not become losing the work — which is the whole point of the
 * change this exists for (docs/06_DECISIONS.md D-037). The response is built from the in-memory Episode, so the
 * person is told either way; only the persistence is best-effort.
 */
export async function persistEpisodeWarning(files: { project: string; outlines: string }, number: number, episode: Record<string, unknown>, message: string): Promise<void> {
  appendEpisodeWarning(episode, message);
  try {
    const outlines: unknown = JSON.parse(await fs.readFile(files.outlines, "utf8"));
    if (!Array.isArray(outlines)) return;
    const row: unknown = outlines[number - 1];
    if (typeof row !== "object" || row === null || Array.isArray(row)) return;
    const copied = [...outlines];
    const updated = { ...(row as Record<string, unknown>) };
    appendEpisodeWarning(updated, message);
    copied[number - 1] = updated;
    await atomicWriteUtf8File(files.outlines, JSON.stringify(copied, null, 2));
    await atomicWriteUtf8File(files.project, JSON.stringify(episode, null, 2));
  } catch { /* best-effort: the response already carries the sentence */ }
}
