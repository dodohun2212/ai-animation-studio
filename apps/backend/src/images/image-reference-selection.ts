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

/** collectReferenceImages's result: the bytes actually sent, plus how many otherwise-eligible images had to be left out to stay within MAX_REFERENCE_IMAGES — see ImageReview.referencesOmittedCount's doc comment. `omittedCount` counts only images that resolved to real bytes and would have been sent if there were room; a mapping that never resolves to a readable file (deleted Asset, moved folder) was never going to be sent regardless of the cap, so it is not "omitted by the cap" and does not count here. */
export interface CollectedReferenceImages {
  images: Buffer[];
  omittedCount: number;
  /** The same images, in the same order, named by where their bytes came from. See referenceSourcesForScene. */
  sources: string[];
}

/**
 * Names one reference image by where its bytes came from, in a form two runs can be compared by.
 *
 * The prompt text cannot carry this. An Episode sends its references as bytes to the image edit API and records
 * only the prompt, so swapping the protagonist Folder for a different one changes every picture the next
 * generation would make while leaving the recorded prompt character-for-character identical — nothing on disk
 * could tell that anything had changed. That is the gap this closes: the record gains the one fact the prompt
 * never held.
 *
 * A version number rather than a hash of the bytes. Editing a drawing in place produces a new Asset version,
 * which is the event the Asset Library already treats as "this is different now"; hashing would additionally
 * catch a file rewritten behind the library's back, which is not something this app does and not something a
 * user could act on if it were reported. A Folder is named by the child file its representative resolves to,
 * because the Folder's own version does not move when that child is replaced.
 */
function referenceSourceName(mapping: StoredAssetMapping, filePath: string, isFolder: boolean, resolvedVersion: number | null): string {
  if (mapping.version_policy === "snapshot" && mapping.snapshot_path) return "snapshot:" + (mapping.snapshot_sha256 ?? mapping.snapshot_path);
  if (isFolder) return "folder:" + mapping.asset_id + ":" + path.basename(filePath);
  return "asset:" + mapping.asset_id + "@" + String(resolvedVersion ?? "latest");
}

/**
 * Names the continuity image by the file it currently is, not by the fact that there is one.
 *
 * This used to be the constant string "continuity", under a comment saying the image "can be swapped like
 * any other reference, so it is named too". The sentence was right and the name did not carry it: swapping the
 * link to a different project, or redrawing the linked project's final scene, left the recorded name identical,
 * so the staleness check could see that a continuity image had appeared or gone and never that it had become a
 * different picture. The pictures downstream were drawn from something that no longer existed and nothing said
 * so.
 *
 * A version number is what names an Asset reference, and there is none to use here: a generated scene image is
 * not an Asset Library entry, and regenerating one rewrites the same path (`writeBinary` renames onto the
 * existing filename), so neither the path nor any stored number moves when the picture does. What does move is
 * the file itself, and `resolveReferences` already stats it — so the stat is the identity, at no extra read.
 *
 * Not a hash of the bytes, which would be exact: this runs once per scene every time staleness is recomputed,
 * and hashing would turn a screen read into a full read of every reference image. The cost of the cheaper
 * answer is that copying a project directory (a backup restore, a move between machines) changes mtime without
 * changing any picture, and those scenes would report their references as changed — a wrong badge on a screen,
 * never a wrong picture or a wrong charge. Recording a hash when the image is written would beat both and is a
 * larger change than this one.
 */
function continuitySourceName(filePath: string, stat: { readonly mtimeMs: number; readonly size: number }): string {
  return "continuity:" + path.basename(filePath) + "@" + String(Math.trunc(stat.mtimeMs)) + ":" + String(stat.size);
}

interface ResolvedReference { readonly filePath: string; readonly source: string }

/**
 * Resolves which files this scene's references come from, without reading any of them.
 *
 * Split out so `collectReferenceImages` and the staleness check cannot disagree about what a scene's references
 * are: one decides what gets paid for and the other tells the user their pictures are behind, and a second copy
 * of this resolution would let those two drift apart in exactly the way nobody notices until a wrong picture has
 * already been bought (D-031).
 *
 * Existence is checked with `stat` here and by the read itself in the caller. The two answers differ only for a
 * file that exists but cannot be read, and the consequence there is a staleness marker shown for a reference
 * that would in fact have been skipped — a wrong flag, never a wrong picture.
 */
async function resolveReferences(
  assets: LocalAssetsRepository,
  mappings: readonly StoredAssetMapping[],
  directory: string,
  sceneNumber: SceneNumber,
  continuityImagePath: string | null,
): Promise<{ readonly resolved: ResolvedReference[]; readonly omittedCount: number }> {
  const resolved: ResolvedReference[] = [];
  let omittedCount = 0;

  for (const mapping of relevantMappingsForScene(mappings, sceneNumber)) {
    let filePath: string | null = null;
    let version: number | null = null;
    let isFolder = false;
    if (mapping.version_policy === "snapshot" && mapping.snapshot_path) {
      filePath = path.join(directory, mapping.snapshot_path);
    } else {
      const asset = await assets.get(mapping.asset_id).catch(() => null);
      if (!asset) continue;
      // A Folder mapping is always follow_latest (see mappings.service.ts) — its bytes come from whichever
      // child is currently its representative image, never a pinned version of its own.
      isFolder = asset.is_folder;
      if (asset.is_folder) {
        filePath = await assets.resolveFolderRepresentativeContentPath(asset);
      } else if (mapping.version_policy === "pinned_version" && mapping.pinned_version) {
        filePath = assets.resolveVersionContentPath(asset, mapping.pinned_version);
        version = mapping.pinned_version;
      } else {
        filePath = assets.resolveContentPath(asset);
        version = asset.version;
      }
    }
    if (!filePath) continue;
    if (!await fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false)) continue;
    if (resolved.length >= MAX_REFERENCE_IMAGES) { omittedCount += 1; continue; }
    resolved.push({ filePath, source: referenceSourceName(mapping, filePath, isFolder, version) });
  }

  const continuityStat = sceneNumber === 1 && continuityImagePath
    ? await fs.stat(continuityImagePath).then((stat) => stat.isFile() ? stat : null).catch(() => null)
    : null;
  if (continuityImagePath && continuityStat) {
    if (resolved.length >= MAX_REFERENCE_IMAGES) omittedCount += 1;
    else resolved.push({ filePath: continuityImagePath, source: continuitySourceName(continuityImagePath, continuityStat) });
  }

  return { resolved, omittedCount };
}

/**
 * What this scene's references currently are, as names — the recompute half of the staleness check.
 *
 * Compared against the list recorded when the pictures were made: different means the pictures on disk were
 * drawn from references this scene would no longer use. No record means the scene has nothing to be behind,
 * exactly as with the prompt (`imageStaleness`), so it is never reported stale.
 */
export async function referenceSourcesForScene(
  assets: LocalAssetsRepository,
  mappings: readonly StoredAssetMapping[],
  directory: string,
  sceneNumber: SceneNumber,
  continuityImagePath: string | null,
): Promise<string[]> {
  return (await resolveReferences(assets, mappings, directory, sceneNumber, continuityImagePath)).resolved.map((item) => item.source);
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
  /**
   * The directory the mappings belong to, which is where a snapshot's relative path is resolved from.
   *
   * A directory rather than a root plus an id, because an Episode's mappings live under its own directory and
   * not under a project id at all — the same reason the storage layer is told where to write instead of working
   * it out (MappingLocation).
   */
  directory: string,
  sceneNumber: SceneNumber,
  continuityImagePath: string | null,
): Promise<CollectedReferenceImages> {
  const { resolved, omittedCount } = await resolveReferences(assets, mappings, directory, sceneNumber, continuityImagePath);
  const results: Buffer[] = [];
  const sources: string[] = [];
  for (const reference of resolved) {
    const bytes = await fs.readFile(reference.filePath).catch(() => null);
    if (!bytes) continue;
    results.push(bytes);
    sources.push(reference.source);
  }

  return { images: results, omittedCount, sources };
}
