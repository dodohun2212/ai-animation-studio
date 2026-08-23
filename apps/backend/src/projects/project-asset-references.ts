import type { GetShortProjectAssetReferencesResponse, ShortProjectSceneReferenceAsset } from "@ai-animation-studio/shared";

import { invalidRequest } from "./project-api.error.js";
import type { StoredProject } from "./project-storage.schema.js";

const MAX_ATMOSPHERE_SIZE = 20;
const MAX_SCENE_REFERENCE_SIZE = 30;
const MAX_PURPOSE_LENGTH = 200;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads Python's `lore_context.atmosphere_asset_ids` / `scene_reference_assets`, tolerant of legacy or partially-shaped entries. */
export function toShortProjectAssetReferences(stored: StoredProject): GetShortProjectAssetReferencesResponse {
  const atmosphere = stored.lore_context.atmosphere_asset_ids;
  const sceneReferences = stored.lore_context.scene_reference_assets;
  const atmosphereAssetIds = Array.isArray(atmosphere) ? [...new Set(atmosphere.filter((item): item is string => typeof item === "string" && item.trim().length > 0))].sort() : [];
  const sceneReferenceAssets: ShortProjectSceneReferenceAsset[] = isObject(sceneReferences)
    ? Object.entries(sceneReferences)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([assetId, purpose]) => ({ assetId, purpose }))
      .sort((left, right) => left.assetId.localeCompare(right.assetId))
    : [];
  return { atmosphereAssetIds, sceneReferenceAssets };
}

export function parseShortProjectAssetReferences(value: unknown): GetShortProjectAssetReferencesResponse {
  if (!isObject(value) || Object.keys(value).some((key) => !["atmosphereAssetIds", "sceneReferenceAssets"].includes(key))
    || !("atmosphereAssetIds" in value) || !("sceneReferenceAssets" in value)
    || !Array.isArray(value.atmosphereAssetIds) || !Array.isArray(value.sceneReferenceAssets)) {
    throw invalidRequest("Request body must contain only atmosphereAssetIds and sceneReferenceAssets arrays.", { field: "atmosphereAssetIds" });
  }
  if (value.atmosphereAssetIds.length > MAX_ATMOSPHERE_SIZE) {
    throw invalidRequest(`atmosphereAssetIds must contain at most ${MAX_ATMOSPHERE_SIZE} Assets.`, { field: "atmosphereAssetIds" });
  }
  if (value.sceneReferenceAssets.length > MAX_SCENE_REFERENCE_SIZE) {
    throw invalidRequest(`sceneReferenceAssets must contain at most ${MAX_SCENE_REFERENCE_SIZE} Assets.`, { field: "sceneReferenceAssets" });
  }

  const seenAtmosphere = new Set<string>();
  const atmosphereAssetIds = value.atmosphereAssetIds.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw invalidRequest(`atmosphereAssetIds[${index}] must be a non-empty string.`, { field: `atmosphereAssetIds[${index}]` });
    }
    const assetId = item.trim();
    if (seenAtmosphere.has(assetId)) {
      throw invalidRequest(`atmosphereAssetIds[${index}] is a duplicate.`, { field: `atmosphereAssetIds[${index}]` });
    }
    seenAtmosphere.add(assetId);
    return assetId;
  });

  const seenSceneReference = new Set<string>();
  const sceneReferenceAssets = value.sceneReferenceAssets.map((item, index) => {
    if (!isObject(item) || Object.keys(item).some((key) => !["assetId", "purpose"].includes(key))) {
      throw invalidRequest(`sceneReferenceAssets[${index}] must contain only assetId and purpose.`, { field: `sceneReferenceAssets[${index}]` });
    }
    const assetId = item.assetId;
    const purpose = item.purpose;
    if (typeof assetId !== "string" || !assetId.trim()) {
      throw invalidRequest(`sceneReferenceAssets[${index}].assetId is required.`, { field: `sceneReferenceAssets[${index}].assetId` });
    }
    if (typeof purpose !== "string" || !purpose.trim() || purpose.trim().length > MAX_PURPOSE_LENGTH) {
      throw invalidRequest(`sceneReferenceAssets[${index}].purpose must be a non-empty string up to ${MAX_PURPOSE_LENGTH} characters.`, { field: `sceneReferenceAssets[${index}].purpose` });
    }
    const trimmedId = assetId.trim();
    if (seenSceneReference.has(trimmedId)) {
      throw invalidRequest(`sceneReferenceAssets[${index}].assetId is a duplicate.`, { field: `sceneReferenceAssets[${index}].assetId` });
    }
    if (seenAtmosphere.has(trimmedId)) {
      throw invalidRequest(`sceneReferenceAssets[${index}].assetId is already selected as an atmosphere Asset.`, { field: `sceneReferenceAssets[${index}].assetId` });
    }
    seenSceneReference.add(trimmedId);
    return { assetId: trimmedId, purpose: purpose.trim() };
  });

  return { atmosphereAssetIds, sceneReferenceAssets };
}

export function applyShortProjectAssetReferences(stored: StoredProject, references: GetShortProjectAssetReferencesResponse, updatedAt: string): StoredProject {
  return {
    ...stored,
    updated_at: updatedAt,
    lore_context: {
      ...stored.lore_context,
      atmosphere_asset_ids: [...references.atmosphereAssetIds].sort(),
      scene_reference_assets: Object.fromEntries(references.sceneReferenceAssets.map((item) => [item.assetId, item.purpose])),
    },
  };
}
