import type { SceneNumber } from "./domain.js";

export type AssetMappingStatus =
  | "confirmed"
  | "suggested"
  | "ambiguous"
  | "unmatched"
  | "excluded"
  | "invalid";

export type AssetMappingAssignmentSource =
  | "manual"
  | "auto"
  | "migrated"
  | "approved_generated_image";

export type AssetMappingVersionPolicy =
  | "pinned_version"
  | "follow_latest"
  | "snapshot";

export type AssetMappingSceneScope =
  | { kind: "all" }
  | { kind: "scene"; sceneNumber: SceneNumber }
  | { kind: "range"; startScene: SceneNumber; endScene: SceneNumber }
  | { kind: "list"; sceneNumbers: SceneNumber[] };

export interface AssetMappingSnapshot {
  /** Project-relative path only; absolute filesystem paths are never public. */
  relativePath: string;
  sha256: string;
  sourceVersion: number;
}

export interface ProjectAssetMapping {
  mappingId: string;
  projectId: string;
  assetId: string;
  enabled: boolean;
  usageRole: string;
  sceneScope: AssetMappingSceneScope;
  assignmentSource: AssetMappingAssignmentSource;
  confidence: number | null;
  matchReason: string;
  status: AssetMappingStatus;
  userConfirmed: boolean;
  versionPolicy: AssetMappingVersionPolicy;
  pinnedVersion: number | null;
  candidateOnly: boolean;
  createdAt: string;
  updatedAt: string;
  snapshot: AssetMappingSnapshot | null;
  selectedChildAssetIds: string[];
}

export interface ListProjectAssetMappingsResponse {
  mappings: ProjectAssetMapping[];
}

export interface CreateProjectAssetMappingRequest {
  assetId: string;
  usageRole: string;
  sceneScope: AssetMappingSceneScope;
  versionPolicy?: AssetMappingVersionPolicy;
  pinnedVersion?: number | null;
  selectedChildAssetIds?: string[];
}

export interface CreateProjectAssetMappingResponse {
  mapping: ProjectAssetMapping;
}

export type UpdateProjectAssetMappingDecision = "confirm" | "exclude";

export interface UpdateProjectAssetMappingRequest {
  decision?: UpdateProjectAssetMappingDecision;
  enabled?: boolean;
  versionPolicy?: AssetMappingVersionPolicy;
  pinnedVersion?: number | null;
}

export interface UpdateProjectAssetMappingResponse {
  mapping: ProjectAssetMapping;
  review: ProjectAssetMappingReview;
}

export type ProjectAssetMappingReviewStatus = "waiting" | "approved";

export interface ProjectAssetMappingReview {
  projectId: string;
  mappingRevision: number;
  scriptRevision: number;
  scriptFingerprint: string;
  status: ProjectAssetMappingReviewStatus;
  approvedAt: string | null;
  approvedBy: string | null;
  textOnlyConfirmed: boolean;
  legacyConfirmed: boolean;
  reviewedScenes: SceneNumber[];
}

export interface BeginProjectAssetMappingReviewRequest {
  scriptRevision: number;
  reviewedScenes?: SceneNumber[];
  textOnlyConfirmed?: boolean;
  legacyConfirmed?: boolean;
}

export interface BeginProjectAssetMappingReviewResponse {
  review: ProjectAssetMappingReview;
}

/** Current review state used when reopening the mapping-review screen. */
export interface GetProjectAssetMappingReviewResponse {
  review: ProjectAssetMappingReview;
}

export interface ApproveProjectAssetMappingReviewRequest {
  scriptFingerprint: string;
  approvedBy?: string;
}

export interface ApproveProjectAssetMappingReviewResponse {
  review: ProjectAssetMappingReview;
}

export interface SnapshotProjectAssetMappingResponse {
  mapping: ProjectAssetMapping;
}
