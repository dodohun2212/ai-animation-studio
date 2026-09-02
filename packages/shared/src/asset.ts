/**
 * Asset categories persisted by the Python Asset Library.
 *
 * The array is the source and the type is derived from it, because a union written out here and a `Set` written
 * out again in the server that reads stored files is two lists that must agree and cannot be made to. That is
 * not hypothetical: the merge wrote a `used_audio.mode` its own storage schema refused to read back, and every
 * project made that way disappeared from the list with no error anywhere (docs/06_DECISIONS.md, Cowork Round
 * 436). These two lists happen to agree today. This is what keeps them agreeing.
 */
export const ASSET_TYPES = ["character", "style", "background", "object", "general_reference"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** Same reason as {@link ASSET_TYPES}: asset-storage.ts validates stored files against this exact list. */
export const ASSET_STATUSES = ["generated", "approved", "rejected", "replaced", "missing", "manual"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface AssetVersion {
  version: number;
  contentSha256: string;
  createdAt: string;
  notes: string;
}

export interface AssetReferenceImage {
  role: string;
  contentSha256: string;
  originalFilename: string;
}

/**
 * Public camel-case representation derived from a legacy assets.json record.
 * Filesystem paths remain backend-internal; clients load the representative
 * image through contentUrl. Folder, version, and reference metadata remains
 * readable, but the minimal API does not expose mutation routes for it.
 */
export interface Asset {
  assetId: string;
  assetType: AssetType;
  displayName: string;
  description: string;
  originalFilename: string;
  contentSha256: string;
  imageAvailable: boolean;
  contentUrl: string | null;
  tags: string[];
  aliases: string[];
  enabled: boolean;
  approved: boolean;
  faceBaseline: boolean;
  characterKey: string | null;
  version: number;
  versions: AssetVersion[];
  createdAt: string;
  updatedAt: string;
  notes: string;
  legacyAssetIds: string[];
  status: AssetStatus;
  sourceProjectId: string;
  sourceSceneNumber: number | null;
  referenceImages: AssetReferenceImage[];
  referenceRoles: string[];
  isFolder: boolean;
  parentFolderId: string;
  childAssetIds: string[];
  thumbnailAssetId: string;
  role: string;
  sortOrder: number;
}

export type AssetOwnership = "library_manual" | "project_owned" | "external";
