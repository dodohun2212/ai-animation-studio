import * as crypto from "node:crypto";
import type { Dirent } from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type { AssetType, RunLegacyReferenceMigrationResponse } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "./mappings.repository.js";
import { parseScope, type StoredAssetMapping } from "./mapping-storage.js";

const REFERENCE_TYPES = new Set<AssetType>(["character", "style", "background", "object", "general_reference"]);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

interface ParsedLegacyReference {
  assetId: string;
  storedPath: string;
  displayName: string;
  approved: boolean;
  referenceType: AssetType;
  enabled: boolean;
  sceneScope: StoredAssetMapping["scene_scope"];
  notes: string;
  characterId: string | null;
  faceBaseline: boolean;
}

function parseLegacyReference(value: unknown): ParsedLegacyReference | null {
  if (!isObject(value) || typeof value.asset_id !== "string" || !value.asset_id || typeof value.stored_path !== "string" || !value.stored_path) return null;
  const referenceType = typeof value.reference_type === "string" && REFERENCE_TYPES.has(value.reference_type as AssetType) ? value.reference_type as AssetType : "general_reference";
  let sceneScope: StoredAssetMapping["scene_scope"];
  try { sceneScope = parseScope(value.scene_scope); } catch { sceneScope = { mode: "all" }; }
  return {
    assetId: value.asset_id, storedPath: value.stored_path,
    displayName: typeof value.display_name === "string" && value.display_name.trim() ? value.display_name : value.asset_id,
    approved: value.source === "approved_generated_image",
    referenceType, enabled: value.enabled !== false, sceneScope,
    notes: typeof value.notes === "string" ? value.notes : "",
    characterId: typeof value.character_id === "string" ? value.character_id : null,
    faceBaseline: value.face_baseline === true && referenceType === "character",
  };
}

/**
 * Idempotently imports every project's legacy `reference_assets/references.json` (from the preserved Python
 * baseline) into the Asset Library and a confirmed, migrated project Asset Mapping — matching Python's
 * `LegacyReferenceMigrator`. Never modifies or deletes a legacy file, never calls an external Provider or media tool, and a
 * single damaged project or reference never blocks migration for the rest.
 */
@Injectable()
@Injectable()
export class LegacyReferenceMigrationService {
  constructor(
    private readonly assets: LocalAssetsRepository,
    private readonly mappings: LocalProjectAssetMappingsRepository,
    private readonly learningDataRoot: string,
  ) {}

  async migrateAll(): Promise<RunLegacyReferenceMigrationResponse> {
    const report = { projectsScanned: 0, migratedAssets: 0, deduplicatedAssets: 0, failedAssets: 0 };
    const projectsRoot = path.join(this.learningDataRoot, "projects");
    let entries: Dirent[];
    try { entries = await fsPromises.readdir(projectsRoot, { withFileTypes: true }); } catch { return report; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "_asset_library_manual") continue;
      const projectDir = path.join(projectsRoot, entry.name);
      const legacyPath = path.join(projectDir, "reference_assets", "references.json");
      const stat = await fsPromises.stat(legacyPath).catch(() => null);
      if (!stat?.isFile()) continue;
      report.projectsScanned += 1;
      try { await this.migrateProject(entry.name, projectDir, legacyPath, report); } catch { report.failedAssets += 1; }
    }
    return report;
  }

  private async migrateProject(projectId: string, projectDir: string, legacyPath: string, report: RunLegacyReferenceMigrationResponse): Promise<void> {
    let raw: unknown;
    try { raw = JSON.parse(await fsPromises.readFile(legacyPath, "utf8")); } catch { report.failedAssets += 1; return; }
    if (!Array.isArray(raw)) { report.failedAssets += 1; return; }
    let mappings: StoredAssetMapping[];
    try { mappings = await this.mappings.load(this.mappings.projectLocation(projectId)); } catch { report.failedAssets += 1; return; }
    let changed = false;
    for (const rawEntry of raw) {
      const legacy = parseLegacyReference(rawEntry);
      if (!legacy) { report.failedAssets += 1; continue; }
      const resolvedSource = path.resolve(projectDir, legacy.storedPath);
      const relative = path.relative(projectDir, resolvedSource);
      if (relative.startsWith("..") || path.isAbsolute(relative)) { report.failedAssets += 1; continue; }
      let libraryAssets: Awaited<ReturnType<LocalAssetsRepository["list"]>>;
      try { libraryAssets = await this.assets.list(); } catch { report.failedAssets += 1; continue; }
      const alreadyMigratedAssetIds = new Set(libraryAssets.filter((asset) => asset.legacy_asset_ids.includes(legacy.assetId)).map((asset) => asset.asset_id));
      if (mappings.some((mapping) => mapping.assignment_source === "migrated" && alreadyMigratedAssetIds.has(mapping.asset_id))) continue;
      const bytes = await fsPromises.readFile(resolvedSource).catch(() => null);
      if (!bytes) { report.failedAssets += 1; continue; }
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      const wasAlreadyIndexed = libraryAssets.some((asset) => !asset.is_folder && asset.content_sha256 === digest);
      let asset: Awaited<ReturnType<LocalAssetsRepository["importLegacyReference"]>>;
      try {
        asset = await this.assets.importLegacyReference(resolvedSource, {
          assetType: legacy.referenceType, displayName: legacy.displayName, approved: legacy.approved,
          faceBaseline: legacy.faceBaseline, characterKey: legacy.characterId, notes: legacy.notes, legacyAssetId: legacy.assetId,
        });
      } catch { report.failedAssets += 1; continue; }
      if (wasAlreadyIndexed) report.deduplicatedAssets += 1;
      const now = new Date().toISOString();
      mappings.push({
        mapping_id: `MAP-${crypto.randomBytes(8).toString("hex").toUpperCase()}`, project_id: projectId, asset_id: asset.asset_id,
        enabled: legacy.enabled, usage_role: legacy.referenceType, scene_scope: legacy.sceneScope, assignment_source: "migrated",
        confidence: null, match_reason: "legacy_reference_migration", status: "confirmed", user_confirmed: true,
        version_policy: "pinned_version", pinned_version: asset.version, candidate_only: false, created_at: now, updated_at: now,
        snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [],
      });
      changed = true;
      report.migratedAssets += 1;
    }
    if (changed) { try { await this.mappings.save(this.mappings.projectLocation(projectId), mappings); } catch { report.failedAssets += 1; } }
  }
}
