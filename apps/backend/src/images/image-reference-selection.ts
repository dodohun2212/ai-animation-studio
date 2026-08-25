import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SceneNumber } from "@ai-animation-studio/shared";
import { scopeIncludes, type StoredAssetMapping } from "../mappings/mapping-storage.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";

/** Matches Python's `OpenAIImageAdapter.MAX_REFERENCE_IMAGES`. */
export const MAX_REFERENCE_IMAGES = 16;

/**
 * Resolves the actual approved Reference image bytes for one scene: every confirmed, enabled Asset Mapping
 * scoped to this scene (character/background/object/style — usage_role is not restricted here, mirroring
 * Python's `resolver.image_pipeline_selection`, which does not filter by role either), plus — for scene 1 only —
 * the linked previous project's approved final-scene image (that project's own last scene, not a fixed Scene 6),
 * when present. A mapping to a Folder Asset resolves to that Folder's current representative child image. Never
 * trusts a client-supplied path; every
 * file comes from already-validated stored data (Asset Library version resolution or an already-checked
 * continuity link). Files that no longer exist are skipped rather than failing the whole generation.
 */
export async function collectReferenceImages(
  assets: LocalAssetsRepository,
  mappings: readonly StoredAssetMapping[],
  projectsRoot: string,
  projectId: string,
  sceneNumber: SceneNumber,
  continuityImagePath: string | null,
): Promise<Buffer[]> {
  const results: Buffer[] = [];
  const relevant = mappings.filter((mapping) => mapping.status === "confirmed" && mapping.enabled && scopeIncludes(mapping.scene_scope, sceneNumber));

  for (const mapping of relevant) {
    if (results.length >= MAX_REFERENCE_IMAGES) break;
    let filePath: string | null = null;
    if (mapping.version_policy === "snapshot" && mapping.snapshot_path) {
      filePath = path.join(projectsRoot, projectId, mapping.snapshot_path);
    } else {
      const asset = await assets.get(mapping.asset_id).catch(() => null);
      if (!asset) continue;
      // A Folder mapping is always follow_latest (see mappings.service.ts) — its bytes come from whichever
      // child is currently its representative image, never a pinned version of its own.
      filePath = asset.is_folder
        ? await assets.resolveFolderRepresentativeContentPath(asset)
        : mapping.version_policy === "pinned_version" && mapping.pinned_version
          ? assets.resolveVersionContentPath(asset, mapping.pinned_version)
          : assets.resolveContentPath(asset);
    }
    if (!filePath) continue;
    const bytes = await fs.readFile(filePath).catch(() => null);
    if (bytes) results.push(bytes);
  }

  if (sceneNumber === 1 && continuityImagePath && results.length < MAX_REFERENCE_IMAGES) {
    const bytes = await fs.readFile(continuityImagePath).catch(() => null);
    if (bytes) results.push(bytes);
  }

  return results.slice(0, MAX_REFERENCE_IMAGES);
}
