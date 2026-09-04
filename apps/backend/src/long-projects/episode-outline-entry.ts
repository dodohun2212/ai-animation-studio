import { LONG_EPISODE_STATUSES, type LongEpisodeOutline, type LongEpisodeStatus } from "@ai-animation-studio/shared";
import { longInvalidData } from "./long-project-api.error.js";

/**
 * One entry of `episode_outlines.json`, read the same way wherever it is read.
 *
 * The outline is the only record that exists for an Episode nobody has scripted yet — the directory holding
 * `project.json` is created by `episode-scripts.service.ts`'s save and by nothing else, so an Episode the person
 * has planned but not written has an outline and no file. Code that reads it as "the Episode is not there"
 * reports an Episode the project plainly has as absent: the continuity save told 캡틴D their 4th Episode of ten
 * was the last one (Cowork Round 474), and the same premise has now caught this repository three times
 * (Rounds 463, 464, 474).
 *
 * Parsed here once so the project listing and the continuity save cannot disagree about what a planned Episode
 * looks like. Warnings stay with the listing: they are the screen's business, not the shape's.
 */
export function parseEpisodeOutlineEntry(raw: unknown, episodeNumber: number): LongEpisodeOutline {
  const entry = raw as Record<string, unknown>;
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || entry.episode_number !== episodeNumber
    || typeof entry.title !== "string" || typeof entry.summary !== "string" || typeof entry.main_event !== "string"
    || typeof entry.conflict !== "string" || typeof entry.cliffhanger !== "string" || typeof entry.next_episode_hook !== "string"
    || !(LONG_EPISODE_STATUSES as readonly string[]).includes(entry.status as string)) throw longInvalidData();
  return { episodeNumber, title: entry.title, summary: entry.summary, mainEvent: entry.main_event, conflict: entry.conflict, cliffhanger: entry.cliffhanger, nextEpisodeHook: entry.next_episode_hook, status: entry.status as LongEpisodeStatus };
}
