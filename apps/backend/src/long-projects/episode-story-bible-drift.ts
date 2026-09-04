import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { LongEpisodeStoryBibleLinkDrift } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import type { StoredAssetMapping } from "../mappings/mapping-storage.js";
import { longStoryRoot } from "./long-project-paths.js";

/** What the comparison found, and whether it managed to look at all -- see the catch below for why those are not the same answer. */
export interface StoryBibleLinkDriftResult { links: LongEpisodeStoryBibleLinkDrift[]; unreadable: boolean }

/**
 * Whether this Episode's pictures were made from a different protagonist or style than the Story Bible now names.
 *
 * A different question from `referenceStale`, and the reason both exist is Captain D's rule itself. An Episode
 * that has already bought pictures keeps the mapping those pictures were made from — deliberately, so the record
 * and the files agree — which means nothing about that Episode changes when the Story Bible link moves, and a
 * comparison of its recorded references against its current ones is silent by construction. The two compare
 * different pairs:
 *
 *   referenceStale       recorded references  vs  the ones this Episode would use now
 *   storyBibleLinkDrift  this Episode's mapping  vs  what the Story Bible names now
 *
 * The first catches an Asset edited under finished pictures. Only the second can say "this Episode was made
 * with a different person than the story now has", and that is the sentence the person was promised.
 *
 * Reports what it found, never a judgement about it. Being behind the Story Bible is not automatically wrong —
 * an Episode drawn before the change is allowed to keep the character it was drawn with, and only the person
 * can decide whether to redraw it. The screen says what differs; the money stays theirs to spend.
 */
export async function storyBibleLinkDrift(
  projectsRoot: string,
  assets: LocalAssetsRepository,
  projectId: string,
  mappings: readonly StoredAssetMapping[],
): Promise<StoryBibleLinkDriftResult> {
  let basic: Record<string, unknown>;
  try {
    const stored: unknown = JSON.parse(await fs.readFile(path.join(longStoryRoot(projectsRoot, projectId), "story_bible.json"), "utf8"));
    // A file that is not an object is not a Story Bible with no links in it; it is one nobody can read.
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { links: [], unreadable: true };
    const value = (stored as Record<string, unknown>).basic;
    // `basic` absent is the ordinary case: a project that has set no links yet has nothing to disagree with.
    if (!value || typeof value !== "object" || Array.isArray(value)) return { links: [], unreadable: false };
    basic = value as Record<string, unknown>;
  } catch (error) {
    // No Story Bible at all is an answer. Anything else -- malformed JSON, a directory that will not read -- is
    // this function failing to find out, and returning the same empty list for both is how a screen goes silent
    // about a real difference. Silence is not neutral here: the paid regenerate button sits directly under it,
    // and this list is what produces the sentence saying an Episode was drawn with a different character than
    // the story now has.
    return { links: [], unreadable: (error as NodeJS.ErrnoException).code !== "ENOENT" };
  }

  const drift: LongEpisodeStoryBibleLinkDrift[] = [];
  for (const [link, field, tag] of [["protagonist", "protagonist_asset_link", "auto_protagonist"], ["style", "style_asset_link", "auto_style"]] as const) {
    const linked = linkedAssetId(basic[field]);
    if (!linked) continue;
    // The question is whether this Episode was drawn with the person the story now names, and generation does
    // not care who attached them: `relevantMappingsForScene` filters on confirmed/enabled/in-scope and never
    // looks at `assignment_source`. So a protagonist connected by hand is in the pictures, and asking only
    // about the mapping this link owns called that "연결 없음" — 캡틴D linked 이배드 by hand, paid for four
    // Episodes' pictures with 이배드 in them, and was told the Episode had been made with nobody
    // (Cowork Round 468). Before automatic seeding existed there was never an `auto` mapping at all, so that
    // sentence was on every Episode of every project that had a protagonist link.
    if (mappings.some((mapping) => mapping.enabled && mapping.status === "confirmed" && mapping.asset_id === linked)) continue;
    // Still the tag's own mapping when there *is* a difference to report: it is the only mapping that can be
    // called "the protagonist this Episode used". A hand-added character is not that — it may be anyone in the
    // scene — and naming one here would trade a false alarm for a false answer.
    const mapped = mappings.find((mapping) => mapping.assignment_source === "auto" && mapping.match_reason === tag && mapping.enabled && mapping.status === "confirmed");
    drift.push({
      link,
      storyBibleAssetId: linked,
      storyBibleAssetName: await displayName(assets, linked),
      episodeAssetId: mapped?.asset_id ?? null,
      episodeAssetName: mapped ? await displayName(assets, mapped.asset_id) : null,
    });
  }
  return { links: drift, unreadable: false };
}

/** The id itself when the Asset is gone: a name the screen cannot show is worse than an id it can quote. */
async function displayName(assets: LocalAssetsRepository, assetId: string): Promise<string> {
  return (await assets.get(assetId).catch(() => null))?.display_name || assetId;
}

function linkedAssetId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).asset_id;
  return typeof id === "string" && id.trim().length > 0 ? id : null;
}
