import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SceneNumber } from "@ai-animation-studio/shared";
import { scopeIncludes, type StoredAssetMapping } from "../mappings/mapping-storage.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { folderChildDescriptions } from "../story/story-asset-metadata.js";

/** Matches Python's `OpenAIImageAdapter.MAX_REFERENCE_IMAGES`. */
export const MAX_REFERENCE_IMAGES = 16;

/** The same confirmed/enabled/in-scope filter `collectReferenceImages` uses, kept in one place so the text description below and the reference bytes it accompanies can never describe a different set of Asset Mappings than they show. */
function relevantMappingsForScene(mappings: readonly StoredAssetMapping[], sceneNumber: SceneNumber): StoredAssetMapping[] {
  return mappings.filter((mapping) => mapping.status === "confirmed" && mapping.enabled && scopeIncludes(mapping.scene_scope, sceneNumber));
}

/**
 * The image model receives the mapped Assets' bytes via `collectReferenceImages` but, until this was added,
 * never any text about them — so a reference photo reached the model with no name attached to it, and the parts
 * of an Asset's description that a photo cannot show on its own (a character's stated personality, a prop's
 * material, anything about a Folder's individual children beyond the one representative image actually sent)
 * never reached the model at all. Mirrors `describeCharacterCast`'s Folder-plus-children shape from the Story
 * prompt (see `folderChildDescriptions`), but sourced from this project's actual confirmed Asset Mappings for
 * this scene rather than the settings-level cast/atmosphere/reference lists Story reads — those two sets can
 * differ, and the image model must be told about what it is actually being shown, not what the user separately
 * said the project is about. Returns "" when the scene has no confirmed mapping, so callers can omit the section
 * entirely rather than emit an empty "References:" heading.
 */
export async function describeReferenceMappingsForScene(
  assets: LocalAssetsRepository,
  mappings: readonly StoredAssetMapping[],
  sceneNumber: SceneNumber,
): Promise<string> {
  const blocks: string[] = [];
  for (const mapping of relevantMappingsForScene(mappings, sceneNumber)) {
    const asset = await assets.get(mapping.asset_id).catch(() => null);
    if (!asset) continue;
    const childLines = await folderChildDescriptions(assets, asset);
    blocks.push([
      `- ${asset.display_name} (${mapping.usage_role.trim() || asset.asset_type})`,
      `  설명: ${asset.description.trim() || "별도 설명 없음"}`,
      ...(childLines.length > 0 ? [`  하위 이미지별 개별 특징: ${childLines.join(" / ")}`] : []),
    ].join("\n"));
  }
  return blocks.length > 0 ? `References:\n${blocks.join("\n")}` : "";
}

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

  for (const mapping of relevantMappingsForScene(mappings, sceneNumber)) {
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
