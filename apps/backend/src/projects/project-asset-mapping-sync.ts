import * as crypto from "node:crypto";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import type { StoredAssetMapping } from "../mappings/mapping-storage.js";

export interface DesiredAutoMapping {
  assetId: string;
  usageRole: string;
}

/**
 * Before this, a user chose a character/atmosphere/reference Asset twice: once in Project Settings (feeds only
 * the Story prompt's text metadata) and again in Asset Mapping review (feeds the image model's Reference bytes)
 * — the two systems never told each other anything, so "설정에서 골랐다"이 그림에 반영되지 않았다. This keeps one tag's worth of `assignment_source: "auto"` mappings in sync with
 * whatever the caller now considers "desired" for that tag (one call site per settings section — cast,
 * atmosphere, scene references — each with its own `tag` so saving one section never touches another's mappings).
 *
 * `status: "confirmed"`/`user_confirmed: true` from the start: the user already chose this Asset by name in
 * Settings, so re-confirming it in Asset Mapping review would just be the same question asked twice — the thing
 * this exists to stop. A manual mapping (or a mapping already owned by a different auto tag) for the same Asset
 * is left alone and no auto mapping is created alongside it: `collectReferenceImages` has no dedup of its own,
 * so two enabled/confirmed mappings for the same Asset would send its picture to the model twice.
 *
 * Never called for a Folder without checking anything about its children — a Folder mapping's bytes always come
 * from its current representative child (see image-reference-selection.ts), which is exactly what Settings'
 * own Folder-based cast/atmosphere pickers already assume.
 */
export async function syncAutoMappings(
  mappings: LocalProjectAssetMappingsRepository,
  assets: LocalAssetsRepository,
  projectId: string,
  tag: string,
  desired: readonly DesiredAutoMapping[],
): Promise<void> {
  const existing = await mappings.load(mappings.projectLocation(projectId));
  const managed = existing.filter((mapping) => mapping.assignment_source === "auto" && mapping.match_reason === tag);
  const other = existing.filter((mapping) => !(mapping.assignment_source === "auto" && mapping.match_reason === tag));

  const next: StoredAssetMapping[] = [];
  for (const item of desired) {
    const current = managed.find((mapping) => mapping.asset_id === item.assetId);
    if (current) {
      next.push(current.usage_role === item.usageRole ? current : { ...current, usage_role: item.usageRole, updated_at: new Date().toISOString() });
      continue;
    }
    if (other.some((mapping) => mapping.asset_id === item.assetId && mapping.enabled && mapping.status === "confirmed")) continue;
    const asset = await assets.get(item.assetId).catch(() => null);
    if (!asset) continue;
    const now = new Date().toISOString();
    next.push({
      mapping_id: `MAP-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
      project_id: projectId,
      asset_id: item.assetId,
      enabled: true,
      usage_role: item.usageRole,
      scene_scope: { mode: "all" },
      assignment_source: "auto",
      confidence: null,
      match_reason: tag,
      status: "confirmed",
      user_confirmed: true,
      version_policy: asset.is_folder ? "follow_latest" : "pinned_version",
      pinned_version: asset.is_folder ? null : asset.version,
      candidate_only: false,
      created_at: now,
      updated_at: now,
      snapshot_path: null,
      snapshot_sha256: null,
      snapshot_source_version: null,
      selected_child_asset_ids: [],
    });
  }

  const changed = next.length !== managed.length || next.some((mapping) => {
    const previous = managed.find((item) => item.asset_id === mapping.asset_id);
    return !previous || previous.mapping_id !== mapping.mapping_id || previous.usage_role !== mapping.usage_role;
  });
  if (changed) await mappings.save(mappings.projectLocation(projectId), [...other, ...next]);
}
