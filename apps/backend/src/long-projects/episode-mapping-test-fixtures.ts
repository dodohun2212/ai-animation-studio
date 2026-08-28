import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { EpisodeMappingOwners, type EpisodeMappingKey } from "./episode-mapping-owner.js";

/**
 * Puts an Episode through an approved, text-only asset mapping review — the state most of the steps after it
 * require before they will run at all.
 *
 * Shared rather than repeated because six test files need the same three-line dance, and because it drives the
 * real flow rather than writing the files by hand: if the review this produces and the state the next step
 * checks ever stop agreeing, every one of those files fails, which is what tells us. A fixture that stamped the
 * files directly would keep passing and prove nothing (docs/06_DECISIONS.md D-017).
 *
 * Kept in src beside the code it drives, following apps/frontend/src/api/testUtils.ts.
 */
export async function approveEpisodeMappingReview(
  projectsRoot: string,
  learningDataRoot: string,
  projectId: string,
  episodeNumber: number,
): Promise<void> {
  const store = new LocalProjectAssetMappingsRepository(projectsRoot);
  const owners = new EpisodeMappingOwners(projectsRoot);
  const flow = new ProjectAssetMappingsService<EpisodeMappingKey>(store, new LocalAssetsRepository(learningDataRoot), owners);
  const key: EpisodeMappingKey = { projectId, episodeNumber };
  const begun = await flow.beginReview(key, { scriptRevision: (await owners.get(key)).scriptRevision, textOnlyConfirmed: true });
  await flow.approveReview(key, { scriptFingerprint: begun.review.scriptFingerprint });
}
