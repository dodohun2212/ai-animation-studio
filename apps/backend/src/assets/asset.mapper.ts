import type { Asset, AssetOwnership } from "@ai-animation-studio/shared";
import type { StoredAsset } from "./asset-storage.js";

export function ownershipOf(asset: StoredAsset): AssetOwnership {
  if (asset.source_project_id === "_asset_library_manual") return "library_manual";
  if (asset.source_project_id) return "project_owned";
  return "external";
}

export function toPublicAsset(asset: StoredAsset, imageAvailable: boolean): Asset {
  return {
    assetId: asset.asset_id, assetType: asset.asset_type, displayName: asset.display_name,
    description: asset.description, originalFilename: asset.original_filename, contentSha256: asset.content_sha256,
    imageAvailable, contentUrl: imageAvailable ? `/assets/${encodeURIComponent(asset.asset_id)}/content` : null,
    tags: [...asset.tags], aliases: [...asset.aliases], enabled: true, approved: asset.approved,
    faceBaseline: asset.face_baseline, characterKey: asset.character_key, version: asset.version,
    versions: asset.versions.map(({ version, content_sha256, created_at, notes }) => ({ version, contentSha256: content_sha256, createdAt: created_at, notes })),
    createdAt: asset.created_at, updatedAt: asset.updated_at, notes: asset.notes, legacyAssetIds: [...asset.legacy_asset_ids],
    status: asset.status, sourceProjectId: asset.source_project_id, sourceSceneNumber: asset.source_scene_number,
    referenceImages: asset.reference_images.map(({ role, content_sha256, original_filename }) => ({ role, contentSha256: content_sha256, originalFilename: original_filename })),
    referenceRoles: [...asset.reference_roles], isFolder: asset.is_folder, parentFolderId: asset.parent_folder_id,
    childAssetIds: [...asset.child_asset_ids], thumbnailAssetId: asset.thumbnail_asset_id, role: asset.role, sortOrder: asset.sort_order,
  };
}
