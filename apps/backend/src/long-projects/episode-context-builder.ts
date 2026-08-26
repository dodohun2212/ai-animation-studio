/**
 * Priority-based context assembly for one Episode's real AI script generation — a direct port of Python's
 * app/long_story/context_builder.py (`StoryContextBuilder.build`). The exact snake_case keys and truncation
 * order below are load-bearing: they are what the ported Episode script prompt (episode-scripts.service.ts)
 * renders via JSON.stringify and hands to the model, so this must stay byte-for-byte the same shape as the
 * Python original, not a TypeScript-idiomatic redesign.
 *
 * Unlike Python's `build()`, this does no file I/O of its own — the caller (episode-scripts.service.ts) already
 * loads project settings, the Story Bible, the episode outline, and continuity records through its own existing
 * paths (continuityContext() already implements the identical "last 3 episodes full, older ones summary-only"
 * split Python's build() does inline), so this function only assembles and truncates what it is handed.
 */

const dedupe = (items: readonly Record<string, unknown>[]): Record<string, unknown>[] => {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];
  for (const item of items) {
    const key = JSON.stringify(item, Object.keys(item).sort());
    if (!seen.has(key)) { seen.add(key); result.push(item); }
  }
  return result;
};

export interface EpisodeContextInput {
  storyBible: { basic: Record<string, unknown>; world: Record<string, unknown> };
  /** snake_case project fields, matching Python's project_overview payload exactly (title/logline/overview/genre/tone/theme/episode_count/episode_duration_seconds/ending_direction/platform/aspect_ratio/audience/notes/starting_state/midpoint/story_flow_summary). */
  projectOverview: Record<string, unknown>;
  /** snake_case episode outline (number/title/summary/core_event/conflict/cliffhanger/next_connection), matching Python's episode.outline shape. */
  episodeOutline: Record<string, unknown>;
  /** Already computed the same way episode-scripts.service.ts's continuityContext() does — {episodeNumber, summary, events, characterChanges, nextActions} for the 3 most recent prior episodes. */
  recentContinuity: readonly Record<string, unknown>[];
  /** {episodeNumber, summary} for prior episodes older than the most recent 3. */
  olderCompressedSummaries: readonly Record<string, unknown>[];
  /** Full Story Bible secrets/foreshadowing arrays — this function does the reveal-episode split and status filter itself, matching Python. */
  secrets: readonly Record<string, unknown>[];
  foreshadowing: readonly Record<string, unknown>[];
  /** This Episode's own scoped candidate characters/locations/props — always empty today (see this module's own reasoning: Python's Episode.character_ids/location_ids/prop_ids are never populated by any code path either, so this mirrors the original's actual behavior, not a TS gap). */
  characters?: readonly Record<string, unknown>[];
  locations?: readonly Record<string, unknown>[];
  props?: readonly Record<string, unknown>[];
  episodeNumber: number;
  userInstruction?: string;
  /** Same default and floor as Python's StoryContextBuilder.__init__. */
  maxCharacters?: number;
}

/** Thrown only when every evictable section is already gone and the payload still exceeds maxCharacters — same as Python's ValueError("Context exceeds the configured maximum size"). */
export class EpisodeContextTooLargeError extends Error {
  constructor() { super("Episode context exceeds the configured maximum size."); }
}

export function buildEpisodeContext(input: EpisodeContextInput): Record<string, unknown> {
  const maxCharacters = input.maxCharacters ?? 18_000;
  if (maxCharacters < 2_000) throw new Error("maxCharacters is too small");

  const allowedSecrets = dedupe(input.secrets.filter((item) => {
    const value = item.reveal_available_episode;
    return (Number.isInteger(value) ? (value as number) : 1) <= input.episodeNumber;
  }));
  const forbiddenSecrets = dedupe(input.secrets.filter((item) => {
    const value = item.reveal_available_episode;
    return (Number.isInteger(value) ? (value as number) : 1) > input.episodeNumber;
  }));
  const unresolvedForeshadowing = dedupe(input.foreshadowing.filter((item) => {
    const status = typeof item.status === "string" ? item.status : "open";
    return status === "open" || status === "planned";
  }));

  const payload: Record<string, unknown> = {
    story_bible: { basic: input.storyBible.basic, world: input.storyBible.world },
    project_overview: input.projectOverview,
    episode_outline: input.episodeOutline,
    recent_continuity: [...input.recentContinuity],
    older_compressed_summaries: [...input.olderCompressedSummaries],
    characters: dedupe(input.characters ?? []),
    locations: dedupe(input.locations ?? []),
    props: dedupe(input.props ?? []),
    unresolved_foreshadowing: unresolvedForeshadowing,
    revealable_information: allowedSecrets,
    forbidden_information: forbiddenSecrets,
    user_instruction: input.userInstruction ?? "",
    included_sections: [] as string[],
    excluded_sections: [] as string[],
  };
  payload.included_sections = Object.entries(payload)
    .filter(([key, value]) => key !== "included_sections" && key !== "excluded_sections" && isTruthy(value))
    .map(([key]) => key);

  const excluded = payload.excluded_sections as string[];
  const olderSummaries = payload.older_compressed_summaries as unknown[];
  const recent = payload.recent_continuity as unknown[];
  const foreshadowingList = payload.unresolved_foreshadowing as unknown[];
  while (JSON.stringify(payload).length > maxCharacters) {
    if (olderSummaries.length > 0) { olderSummaries.shift(); excluded.push("oldest_compressed_summary"); }
    else if (recent.length > 0) { recent.shift(); excluded.push("older_recent_continuity"); }
    else if (foreshadowingList.length > 0) { foreshadowingList.pop(); excluded.push("lower_priority_foreshadowing"); }
    else throw new EpisodeContextTooLargeError();
  }
  return payload;
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.length > 0;
  return Boolean(value);
}
