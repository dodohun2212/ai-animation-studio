import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { syncAutoMappings } from "../projects/project-asset-mapping-sync.js";
import { EpisodeMappingOwners } from "./episode-mapping-owner.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * The Episode states in which no picture has been generated yet.
 *
 * The line this draws is the one Captain D drew: an Episode that has not bought images yet follows the Story
 * Bible, and one that has does not. Changing a mapping under an Episode whose pictures already exist would
 * leave the record saying one thing and the files showing another — the exact shape this repository has spent
 * the week closing — and the pictures do not change to match, because they were already paid for.
 */
const BEFORE_IMAGES_EXIST: readonly string[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images"];

/** The style and protagonist links, as the two auto tags they become. */
export interface StoryBibleLinks {
  readonly styleAssetId?: string;
  readonly protagonistAssetId?: string;
}

/**
 * Pushes the Story Bible's two Asset links into every Episode that has not generated pictures yet.
 *
 * Chosen once for the whole story and used by every Episode is exactly what the short project's Settings do,
 * and `syncAutoMappings` already carries every rule that makes that safe — one tag at a time, never touching a
 * manual mapping, never seeding an Asset someone excluded, never doubling one the model would then be sent
 * twice. This is that function pointed at a different set of directories, not a second implementation.
 *
 * Seeded `confirmed`, like the short project's: someone who chose the protagonist by name in the Story Bible
 * being asked to confirm it again in every Episode's mapping review is the twenty presses this exists to
 * remove. An automatic step that still needs twenty confirmations has only moved the button.
 *
 * Fails soft per Episode and as a whole. Saving a Story Bible link is the thing the person asked for; an
 * Episode folder that cannot be read must not turn that into an error, and the mapping it could not seed is a
 * mapping they can still make by hand.
 */
export async function syncStoryBibleMappings(
  projectsRoot: string,
  mappings: LocalProjectAssetMappingsRepository,
  assets: LocalAssetsRepository,
  projectId: string,
  links: StoryBibleLinks,
): Promise<void> {
  let entries: string[];
  try {
    entries = (await fs.readdir(longStoryRoot(projectsRoot, projectId), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^Episode\d+$/.test(entry.name))
      .map((entry) => entry.name);
  } catch { return; }

  const owners = new EpisodeMappingOwners(projectsRoot);
  for (const name of entries) {
    const episodeNumber = Number(name.slice("Episode".length));
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1) continue;
    try {
      if (!await beforeImages(projectsRoot, projectId, episodeNumber)) continue;
      const owner = await owners.get({ projectId, episodeNumber });
      await syncAutoMappings(mappings, assets, owner, "auto_style", links.styleAssetId ? [{ assetId: links.styleAssetId, usageRole: "style" }] : []);
      await syncAutoMappings(mappings, assets, owner, "auto_protagonist", links.protagonistAssetId ? [{ assetId: links.protagonistAssetId, usageRole: "character" }] : []);
    } catch { continue; }
  }
}

/** Reads the Episode's own state, the same field every other service in this directory treats as authoritative. */
async function beforeImages(projectsRoot: string, projectId: string, episodeNumber: number): Promise<boolean> {
  const file = path.join(longStoryRoot(projectsRoot, projectId), episodeDirectoryName(episodeNumber), "project.json");
  try {
    const stored: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
    const state = (stored as Record<string, unknown>).state;
    return typeof state === "string" && BEFORE_IMAGES_EXIST.includes(state);
  } catch { return false; }
}
