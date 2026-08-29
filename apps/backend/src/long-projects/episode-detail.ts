import type { LongEpisodeDetail, LongEpisodeInstagramPost, LongEpisodeStatus, UsedAudio } from "@ai-animation-studio/shared";

import { toApiEpisodeScript } from "./episode-script-format.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";

/** The stored shape every Episode service already reads; only the fields this mapper touches are named. */
export interface StoredEpisodeForDetail {
  number: number;
  state: LongEpisodeStatus;
  approved: boolean;
  /** Optional because one service's stored type does not name it; the mapper reads it through the index signature. */
  script?: unknown;
  script_revision: number;
  [key: string]: unknown;
}

/**
 * One Episode, as the API describes it.
 *
 * Five services each carried a byte-identical copy of this. That is the third list of its kind in this repo —
 * after the placeholder bytes and the Episode status list — and the first two both drifted before they were
 * collapsed, one of them while six paid clips were being replaced by stubs. The cost of five copies is not the
 * duplication; it is that adding a field means finding all five, and whoever finds four ships a response that
 * is right on some screens and wrong on others.
 */
export function toEpisodeDetail(episode: StoredEpisodeForDetail): LongEpisodeDetail {
  const script = toApiEpisodeScript(episode.script);
  const warnings = withoutStaleEpisodeRecoveryWarnings(
    Array.isArray(episode.warnings) ? episode.warnings.filter((item): item is string => typeof item === "string") : [],
    episode.state,
  );
  return {
    episodeNumber: episode.number,
    title: String(episode.title),
    summary: String(episode.summary),
    mainEvent: String(episode.core_event),
    conflict: String(episode.conflict),
    cliffhanger: String(episode.cliffhanger),
    nextEpisodeHook: String(episode.next_connection),
    status: episode.state,
    approved: episode.approved,
    scriptRevision: episode.script_revision,
    ...(script ? { script } : {}),
    scriptHistoryCount: Array.isArray(episode.script_history) ? episode.script_history.length : 0,
    updatedAt: typeof episode.updated_at === "string" ? episode.updated_at : new Date(0).toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(toEpisodeInstagramPost(episode.instagram_post) ? { instagramPost: toEpisodeInstagramPost(episode.instagram_post)! } : {}),
    ...(toEpisodeUsedAudio(episode.used_audio) ? { usedAudio: toEpisodeUsedAudio(episode.used_audio)! } : {}),
  };
}

/**
 * The published record, read leniently: an Episode written before this field existed simply has none, and a
 * half-written one is treated as none rather than reported as a post nobody can find.
 */
export function toEpisodeInstagramPost(value: unknown): LongEpisodeInstagramPost | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const stored = value as Record<string, unknown>;
  const strings = ["media_id", "ig_user_id", "published_at", "caption"] as const;
  if (strings.some((key) => typeof stored[key] !== "string")) return undefined;
  return {
    mediaId: stored.media_id as string,
    igUserId: stored.ig_user_id as string,
    publishedAt: stored.published_at as string,
    caption: stored.caption as string,
  };
}

/**
 * What the last merge used, read leniently.
 *
 * The credit line is built from this and nothing else, so a half-written record counts as absent rather than
 * being reported as audio with no attribution — the quiet version of publishing a CC BY track uncredited.
 */
export function toEpisodeUsedAudio(value: unknown): UsedAudio | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const stored = value as Record<string, unknown>;
  const mode = stored.mode;
  if (mode !== "narration" && mode !== "narration+bgm" && mode !== "bgm" && mode !== "silent") return undefined;
  return {
    mode,
    ...(typeof stored.track_id === "string" ? { trackId: stored.track_id } : {}),
    ...(typeof stored.attribution_required === "boolean" ? { attributionRequired: stored.attribution_required } : {}),
    ...(typeof stored.attribution_text === "string" ? { attributionText: stored.attribution_text } : {}),
  };
}
