import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { LongEpisodeStoryBibleLinkDrift } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import type { StoredAssetMapping } from "../mappings/mapping-storage.js";
import { longStoryRoot } from "./long-project-paths.js";

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
): Promise<LongEpisodeStoryBibleLinkDrift[]> {
  let basic: Record<string, unknown>;
  try {
    const stored: unknown = JSON.parse(await fs.readFile(path.join(longStoryRoot(projectsRoot, projectId), "story_bible.json"), "utf8"));
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
    const value = (stored as Record<string, unknown>).basic;
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    basic = value as Record<string, unknown>;
  } catch { return []; }

  const drift: LongEpisodeStoryBibleLinkDrift[] = [];
  for (const [link, field, tag] of [["protagonist", "protagonist_asset_link", "auto_protagonist"], ["style", "style_asset_link", "auto_style"]] as const) {
    const linked = linkedAssetId(basic[field]);
    if (!linked) continue;
    // Only the mapping this Story Bible link owns is compared. A character someone added by hand is not the
    // protagonist link disagreeing with itself — it is a second character, which is an ordinary thing to have.
    const mapped = mappings.find((mapping) => mapping.assignment_source === "auto" && mapping.match_reason === tag && mapping.enabled && mapping.status === "confirmed");
    if (mapped?.asset_id === linked) continue;
    drift.push({
      link,
      storyBibleAssetId: linked,
      storyBibleAssetName: await displayName(assets, linked),
      episodeAssetId: mapped?.asset_id ?? null,
      episodeAssetName: mapped ? await displayName(assets, mapped.asset_id) : null,
    });
  }
  return drift;
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
