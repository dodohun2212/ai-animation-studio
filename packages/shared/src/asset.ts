/** Asset categories persisted by the Python Asset Library. */
export type AssetType =
  | "character"
  | "style"
  | "background"
  | "object"
  | "general_reference";

export type AssetStatus =
  | "generated"
  | "approved"
  | "rejected"
  | "replaced"
  | "missing"
  | "manual";

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
