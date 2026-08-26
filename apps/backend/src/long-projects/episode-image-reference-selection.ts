import * as fs from "node:fs/promises";
import type { LongEpisodeAssetMappingCandidate } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";

/** Matches images/image-reference-selection.ts's MAX_REFERENCE_IMAGES (Python's OpenAIImageAdapter limit). */
export const MAX_REFERENCE_IMAGES = 16;

/**
 * Episode-scoped equivalent of images/image-reference-selection.ts's collectReferenceImages, adapted for the Long
 * Episode Asset Mapping candidate shape: every confirmed candidate in scope for this Episode (episodeScope has no
 * per-scene granularity — `{mode:"all"}` or `{mode:"episode", episode:N}` — so unlike the short-project version,
 * the same reference set applies uniformly to every scene 1-6 of the Episode), plus — for scene 1 only — the
 * linked previous Episode's approved final-scene image, when present. A candidate mapped to a Folder Asset
 * resolves to that Folder's current representative child image, same as the short-project path.
 *
 * Long Episode Asset Mapping candidates have no `snapshotPath` field at all (unlike the short-project mapping
 * shape, which supports a `snapshot` versionPolicy pinned to a copied file) — so a `"snapshot"` versionPolicy
 * candidate here resolves to the Asset's current version, same as `"follow_latest"`. There is no actual snapshot
 * to pin to in this data model today.
 */
/** Same shape and "only counts what would really have been sent" meaning as images/image-reference-selection.ts's CollectedReferenceImages — see that type's doc comment. */
export interface CollectedEpisodeReferenceImages {
  images: Buffer[];
  omittedCount: number;
}

export async function collectEpisodeReferenceImages(
  assets: LocalAssetsRepository,
  candidates: readonly LongEpisodeAssetMappingCandidate[],
  episodeNumber: number,
  sceneNumber: number,
  continuityImagePath: string | null,
): Promise<CollectedEpisodeReferenceImages> {
  const results: Buffer[] = [];
  let omittedCount = 0;
  const relevant = candidates.filter((candidate) =>
    candidate.status === "confirmed" && (candidate.episodeScope.mode === "all" || candidate.episodeScope.episode === episodeNumber));

  for (const candidate of relevant) {
    const asset = await assets.get(candidate.assetId).catch(() => null);
    if (!asset) continue;
    const filePath = asset.is_folder
      ? await assets.resolveFolderRepresentativeContentPath(asset)
      : candidate.versionPolicy === "pinned_version" && candidate.pinnedVersion
        ? assets.resolveVersionContentPath(asset, candidate.pinnedVersion)
        : assets.resolveContentPath(asset);
    if (!filePath) continue;
    const bytes = await fs.readFile(filePath).catch(() => null);
    if (!bytes) continue;
    if (results.length >= MAX_REFERENCE_IMAGES) { omittedCount += 1; continue; }
    results.push(bytes);
  }

  if (sceneNumber === 1 && continuityImagePath) {
    const bytes = await fs.readFile(continuityImagePath).catch(() => null);
    if (bytes) {
      if (results.length >= MAX_REFERENCE_IMAGES) omittedCount += 1;
      else results.push(bytes);
    }
  }

  return { images: results, omittedCount };
}
