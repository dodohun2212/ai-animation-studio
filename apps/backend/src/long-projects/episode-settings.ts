import type { LongEpisodeSettings } from "@ai-animation-studio/shared";

/**
 * The one place `episodeDurationSeconds` is computed.
 *
 * It is derived from the other two and never sent by a caller, which only stays true if nothing recomputes it
 * for itself. The project's own settings already work this way; this is the Episode's half of the same rule,
 * kept in a function rather than repeated at each return so the two cannot drift into disagreeing about what
 * "how long is an Episode" means.
 */
export function episodeSettings(sceneCount: number, clipDurationSeconds: number): LongEpisodeSettings {
  return { sceneCount, clipDurationSeconds, episodeDurationSeconds: sceneCount * clipDurationSeconds };
}
