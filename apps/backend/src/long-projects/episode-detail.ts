import type { LongEpisodeDetail, LongEpisodeInstagramPost, LongEpisodeStatus, UsedAudio } from "@ai-animation-studio/shared";

import { toApiEpisodeScript } from "./episode-script-format.js";
import { episodeProjectRelativePath } from "./long-project-paths.js";
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
    ...(errorsOf(episode).length > 0 ? { errors: errorsOf(episode) } : {}),
    // Both, and never one without the other: `finalVideoPath` is where the file sits inside the Episode, which
    // is what a person should be shown, and `openablePath` is the same file from the project root, which is the
    // only form the desktop bridge can resolve. The strings differ by an origin, not by a file — handing the
    // first one to "open in explorer" names a path in some short project instead.
    ...(typeof episode.final_video_path === "string" && episode.final_video_path
      ? { finalVideoPath: episode.final_video_path, openablePath: episodeProjectRelativePath(episode.number, episode.final_video_path) }
      : {}),
    ...(toEpisodeInstagramPost(episode.instagram_post) ? { instagramPost: toEpisodeInstagramPost(episode.instagram_post)! } : {}),
    ...(toEpisodePreviousInstagramPosts(episode.previous_instagram_posts).length > 0
      ? { previousInstagramPosts: toEpisodePreviousInstagramPosts(episode.previous_instagram_posts) } : {}),
    ...(toEpisodeUsedAudio(episode.used_audio) ? { usedAudio: toEpisodeUsedAudio(episode.used_audio)! } : {}),
  };
}

/**
 * Why this Episode failed, if it says.
 *
 * Absent rather than empty when there is nothing: an `errors: []` on every healthy Episode reads as "we
 * checked and it is fine", which is a stronger claim than a stored field that was simply never written to.
 */
export function errorsOf(episode: StoredEpisodeForDetail): string[] {
  return Array.isArray(episode.errors) ? episode.errors.filter((item): item is string => typeof item === "string") : [];
}

/**
 * The posts this Episode has published and then forgotten, oldest first.
 *
 * Same lenient read as the live record and for a stronger reason: this list exists so that clearing
 * `instagram_post` does not erase the fact that something may still be up on the account, and a list that
 * refused to parse would erase exactly what it is for. Entries that do not hold together are dropped rather
 * than guessed at — a half-read record of a public post reads as knowledge.
 */
export function toEpisodePreviousInstagramPosts(value: unknown): LongEpisodeInstagramPost[] {
  if (!Array.isArray(value)) return [];
  return value.map(toEpisodeInstagramPost).filter((post): post is LongEpisodeInstagramPost => post !== undefined);
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
    // Carried only when the record has it. A post written before this was recorded knows nothing about its
    // cover, and absent says that; null would claim the publish sent none.
    ...(stored.thumb_offset_ms === null || typeof stored.thumb_offset_ms === "number" ? { thumbOffsetMs: stored.thumb_offset_ms } : {}),
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
