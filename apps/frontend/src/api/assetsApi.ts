import {
  ASSET_FILE_AUDIT_CLASSIFICATIONS,
  ASSET_OWNERSHIPS, ASSET_STATUSES, ASSET_TYPES,
  API_ROUTES,
  ASSET_UPLOAD_FILE_FIELD,
  MAX_SCENE_COUNT,
  type AddAssetVersionResponse,
  type BackfillGeneratedImageAssetsResponse,
  type Asset,
  type AssetFileAuditClassification,
  type AssetFileAuditEntry,
  type AssetOwnership,
  type AssetReferenceImage,
  type CharacterFolderReferenceSetRequest,
  type CharacterFolderReferenceSetResponse,
  type AssetStatus,
  type AssetType,
  type AssetVersion,
  type CreateAssetFolderRequest,
  type CreateAssetFolderResponse,
  type CreateAssetMetadata,
  type CreateAssetResponse,
  type DeleteAssetFolderRequest,
  type DeleteAssetFolderResponse,
  type DeleteAssetOwnedFileResponse,
  type DeleteAssetResponse,
  type GetAssetResponse,
  type ListAssetFileAuditResponse,
  type ListAssetsQuery,
  type ListAssetsResponse,
  type RelinkAssetResponse,
  type RunLegacyReferenceMigrationResponse,
  type SetAssetParentFolderRequest,
  type SetAssetParentFolderResponse,
  type UpdateAssetMetadataRequest,
  type UpdateAssetResponse,
} from "@ai-animation-studio/shared";

export class AssetsApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AssetsApiError";
    this.code = code;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요.",
  UNSAFE_ASSET_ID: "에셋 ID가 올바르지 않습니다.",
  ASSET_NOT_FOUND: "에셋을 찾을 수 없습니다.",
  ASSET_ALREADY_EXISTS: "같은 이미지가 이미 등록되어 있습니다.",
  ASSET_IN_USE: "프로젝트에서 사용 중인 에셋은 삭제할 수 없습니다.",
  ASSET_MUTATION_UNSUPPORTED: "이 에셋은 현재 수정할 수 없습니다.",
  ASSET_VERSION_DUPLICATE: "이미 등록된 버전입니다.",
  ASSET_JSON_MALFORMED: "에셋 목록 파일을 읽을 수 없습니다.",
  ASSET_DATA_INVALID: "에셋 목록 데이터가 올바르지 않습니다.",
  ASSET_FILE_INVALID: "지원되는 이미지 파일을 선택해 주세요.",
  ASSET_STORAGE_ERROR: "에셋을 저장하거나 읽지 못했습니다.",
};
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };

export function toAssetDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof AssetsApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    return { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  return UNKNOWN;
}

// The contract's own arrays, imported rather than shadowed by two local copies of the same names. These sit
// in a response guard, so a type or status added to the contract and missing here does not disable a feature
// — it makes this client reject a valid response and the screen report a working server as unreadable.
const OWNERSHIPS: readonly AssetOwnership[] = ASSET_OWNERSHIPS;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
/** A full SHA-256 hex digest. The backend's mapper always emits one for a known content byte range. */
const isDigest = (value: unknown): value is string => isString(value) && DIGEST_PATTERN.test(value);
/** Reference-image digests may be an explicitly documented legacy empty string alongside a full digest (see asset-storage.ts). */
const isLegacyOptionalDigest = (value: unknown): value is string => value === "" || isDigest(value);
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]00:00)$/;
const isUtcIsoTimestamp = (value: unknown): value is string =>
  isString(value) && UTC_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
const isVersionNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;
const isSceneNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SCENE_COUNT);
const isSortOrder = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
/** Only the backend's own /assets/:id/content route for this exact asset may ever reach an <img src>. */
const isBoundContentUrl = (assetId: string, imageAvailable: boolean, contentUrl: unknown): contentUrl is string | null =>
  imageAvailable ? contentUrl === API_ROUTES.assetContent(assetId) : contentUrl === null;
const isAssetVersion = (value: unknown): value is AssetVersion =>
  isRecord(value) && isVersionNumber(value.version) && isDigest(value.contentSha256) && isUtcIsoTimestamp(value.createdAt) && isString(value.notes);
const isAssetVersionArray = (value: unknown): value is AssetVersion[] => Array.isArray(value) && value.every(isAssetVersion);
const isAssetReferenceImage = (value: unknown): value is AssetReferenceImage =>
  isRecord(value) && isString(value.role) && isLegacyOptionalDigest(value.contentSha256) && isString(value.originalFilename);
const isAssetReferenceImageArray = (value: unknown): value is AssetReferenceImage[] => Array.isArray(value) && value.every(isAssetReferenceImage);

function isAsset(value: unknown): value is Asset {
  if (!isRecord(value)) return false;
  if (!(isString(value.assetId) && value.assetId.length > 0)) return false;
  if (!ASSET_TYPES.includes(value.assetType as AssetType)) return false;
  if (!(isString(value.displayName) && isString(value.description) && isString(value.originalFilename))) return false;
  if (typeof value.isFolder !== "boolean") return false;
  if (typeof value.imageAvailable !== "boolean") return false;
  if (value.isFolder) {
    // A folder never carries image bytes (see asset-storage.ts's parseAssetIndex "folder file" invariant) —
    // the backend mapper always emits these exact no-content values, never a real digest or content route.
    if (value.contentSha256 !== "") return false;
    if (value.imageAvailable !== false) return false;
    if (value.contentUrl !== null) return false;
    if (!(Array.isArray(value.versions) && value.versions.length === 0)) return false;
    if (!(Array.isArray(value.referenceImages) && value.referenceImages.length === 0)) return false;
  } else {
    if (!isDigest(value.contentSha256)) return false;
    if (!isBoundContentUrl(value.assetId, value.imageAvailable, value.contentUrl)) return false;
    if (!isAssetVersionArray(value.versions)) return false;
    if (!isAssetReferenceImageArray(value.referenceImages)) return false;
  }
  if (!(isStringArray(value.tags) && isStringArray(value.aliases))) return false;
  if (!(typeof value.enabled === "boolean" && typeof value.approved === "boolean" && typeof value.faceBaseline === "boolean")) return false;
  if (!(value.characterKey === null || isString(value.characterKey))) return false;
  if (!isVersionNumber(value.version)) return false;
  if (!(isUtcIsoTimestamp(value.createdAt) && isUtcIsoTimestamp(value.updatedAt))) return false;
  if (!isString(value.notes)) return false;
  if (!isStringArray(value.legacyAssetIds)) return false;
  if (!ASSET_STATUSES.includes(value.status as AssetStatus)) return false;
  if (!isString(value.sourceProjectId)) return false;
  if (!isSceneNumber(value.sourceSceneNumber)) return false;
  if (!isStringArray(value.referenceRoles)) return false;
  if (!isString(value.parentFolderId)) return false;
  if (!isStringArray(value.childAssetIds)) return false;
  if (!isString(value.thumbnailAssetId)) return false;
  if (!isString(value.role)) return false;
  if (!isSortOrder(value.sortOrder)) return false;
  return true;
}

const isListResponse = (value: unknown): value is ListAssetsResponse => isRecord(value) && Array.isArray(value.assets) && value.assets.every(isAsset);
const isCreateResponse = (value: unknown): value is CreateAssetResponse => isRecord(value) && isAsset(value.asset);
const isUpdateResponse = (value: unknown): value is UpdateAssetResponse => isRecord(value) && isAsset(value.asset);
const isGetResponse = (value: unknown): value is GetAssetResponse => isRecord(value) && isAsset(value.asset)
  && isStringArray(value.usageProjectIds) && OWNERSHIPS.includes(value.ownership as AssetOwnership)
  && typeof value.canDeleteOwnedFile === "boolean";
const isDeleteResponse = (value: unknown): value is DeleteAssetResponse => isRecord(value) && isString(value.assetId) && typeof value.deletedOwnedFile === "boolean";
const isCharacterFolderReferenceSetResponse = (value: unknown): value is CharacterFolderReferenceSetResponse =>
  isRecord(value) && isAsset(value.folder) && Array.isArray(value.children) && value.children.every(isAsset);
const isCreateAssetFolderResponse = (value: unknown): value is CreateAssetFolderResponse => isRecord(value) && isAsset(value.asset) && value.asset.isFolder;
const isSetAssetParentFolderResponse = (value: unknown): value is SetAssetParentFolderResponse =>
  isRecord(value) && isAsset(value.asset) && (value.folder === null || isAsset(value.folder));
const isAddVersionResponse = (value: unknown): value is AddAssetVersionResponse => isRecord(value) && isAsset(value.asset);
const isRelinkResponse = (value: unknown): value is RelinkAssetResponse => isRecord(value) && isAsset(value.asset);
const isDeleteOwnedFileResponse = (value: unknown): value is DeleteAssetOwnedFileResponse =>
  isRecord(value) && isString(value.assetId) && value.deletedOwnedFile === true;
const isDeleteFolderResponse = (value: unknown): value is DeleteAssetFolderResponse =>
  isRecord(value) && isString(value.assetId) && isStringArray(value.removedChildAssetIds) && isNonNegativeInteger(value.deletedFiles);
const AUDIT_CLASSIFICATIONS: readonly AssetFileAuditClassification[] = ASSET_FILE_AUDIT_CLASSIFICATIONS;
const isAuditEntry = (value: unknown): value is AssetFileAuditEntry => isRecord(value)
  && isString(value.assetId) && isString(value.displayName) && AUDIT_CLASSIFICATIONS.includes(value.classification as AssetFileAuditClassification)
  && (value.sourceKind === "manual" || value.sourceKind === "project") && isString(value.message);
const isAuditResponse = (value: unknown): value is ListAssetFileAuditResponse => isRecord(value) && Array.isArray(value.entries) && value.entries.every(isAuditEntry);
const isNonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isLegacyMigrationResponse = (value: unknown): value is RunLegacyReferenceMigrationResponse => isRecord(value)
  && isNonNegativeInteger(value.projectsScanned) && isNonNegativeInteger(value.migratedAssets)
  && isNonNegativeInteger(value.deduplicatedAssets) && isNonNegativeInteger(value.failedAssets);
const isBackfillResponse = (value: unknown): value is BackfillGeneratedImageAssetsResponse => isRecord(value)
  && isNonNegativeInteger(value.scanned) && isNonNegativeInteger(value.registered)
  && isNonNegativeInteger(value.skipped) && isNonNegativeInteger(value.failed);

async function request<T>(url: string, init: RequestInit | undefined, guard: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try { response = init ? await fetch(url, init) : await fetch(url); }
  catch { throw new AssetsApiError(NETWORK.code, NETWORK.message); }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const code = isRecord(body) && typeof body.code === "string" && body.code.trim() ? body.code : MALFORMED.code;
    throw new AssetsApiError(code, SAFE_ERRORS[code] ?? UNKNOWN.message);
  }
  if (!guard(body)) throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

export function listAssets(query: ListAssetsQuery = {}): Promise<ListAssetsResponse> {
  const params = new URLSearchParams();
  if (query.query?.trim()) params.set("query", query.query.trim());
  if (query.assetType) params.set("assetType", query.assetType);
  const suffix = params.size ? `?${params.toString()}` : "";
  return request(`${API_ROUTES.assets}${suffix}`, undefined, isListResponse);
}

export async function getAsset(assetId: string): Promise<GetAssetResponse> {
  const response = await request(API_ROUTES.asset(assetId), undefined, isGetResponse);
  if (response.asset.assetId !== assetId) throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  return response;
}

export function createAsset(file: File, metadata: CreateAssetMetadata): Promise<CreateAssetResponse> {
  const body = new FormData();
  body.append(ASSET_UPLOAD_FILE_FIELD, file);
  body.append("metadata", JSON.stringify(metadata));
  return request(API_ROUTES.assets, { method: "POST", body }, isCreateResponse);
}

export async function updateAsset(assetId: string, metadata: UpdateAssetMetadataRequest): Promise<UpdateAssetResponse> {
  const response = await request(API_ROUTES.asset(assetId), {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata),
  }, isUpdateResponse);
  if (response.asset.assetId !== assetId) throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  return response;
}

export async function deleteAsset(assetId: string): Promise<DeleteAssetResponse> {
  const response = await request(API_ROUTES.asset(assetId), { method: "DELETE" }, isDeleteResponse);
  if (response.assetId !== assetId) throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  return response;
}

export async function deleteAssetFolder(assetId: string, options: DeleteAssetFolderRequest): Promise<DeleteAssetFolderResponse> {
  const params = new URLSearchParams();
  if (options.removeChildIndexes) params.set("removeChildIndexes", "true");
  if (options.deleteManualFiles) params.set("deleteManualFiles", "true");
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await request(`${API_ROUTES.assetFolder(assetId)}${suffix}`, { method: "DELETE" }, isDeleteFolderResponse);
  if (response.assetId !== assetId) throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  return response;
}

export async function addAssetVersion(assetId: string, file: File, notes: string): Promise<AddAssetVersionResponse> {
  const body = new FormData();
  body.append(ASSET_UPLOAD_FILE_FIELD, file);
  if (notes.trim()) body.append("notes", notes.trim());
  const response = await request(API_ROUTES.assetVersions(assetId), { method: "POST", body }, isAddVersionResponse);
  if (response.asset.assetId !== assetId) throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  return response;
}

export async function relinkAsset(assetId: string, file: File): Promise<RelinkAssetResponse> {
  const body = new FormData();
  body.append(ASSET_UPLOAD_FILE_FIELD, file);
  const response = await request(API_ROUTES.assetRelink(assetId), { method: "POST", body }, isRelinkResponse);
  if (response.asset.assetId !== assetId) throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  return response;
}

export function listAssetFileAudit(): Promise<ListAssetFileAuditResponse> {
  return request(API_ROUTES.assetsAudit, undefined, isAuditResponse);
}

export async function deleteAssetOwnedFile(assetId: string): Promise<DeleteAssetOwnedFileResponse> {
  const response = await request(API_ROUTES.assetOwnedFile(assetId), { method: "DELETE" }, isDeleteOwnedFileResponse);
  if (response.assetId !== assetId) throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  return response;
}

/** Silently, idempotently imports every project's legacy references into the Library — mirrors Python's on-open self-heal. */
export function runLegacyReferenceMigration(): Promise<RunLegacyReferenceMigrationResponse> {
  return request(API_ROUTES.legacyReferenceMigration, { method: "POST" }, isLegacyMigrationResponse);
}

/**
 * Registers scene images that are already on disk but were never indexed — Episodes and short projects whose
 * pictures were made before indexing existed. Idempotent: an owner that already has a Folder is counted in
 * `skipped`, never registered twice, so running it again is safe.
 */
export function backfillGeneratedImageAssets(): Promise<BackfillGeneratedImageAssetsResponse> {
  return request(API_ROUTES.backfillGeneratedImages, { method: "POST" }, isBackfillResponse);
}

export async function updateCharacterFolderReferenceSet(
  assetId: string,
  requestBody: CharacterFolderReferenceSetRequest,
): Promise<CharacterFolderReferenceSetResponse> {
  const response = await request(API_ROUTES.characterFolderReferenceSet(assetId), {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody),
  }, isCharacterFolderReferenceSetResponse);
  if (response.folder.assetId !== assetId
    || !response.folder.isFolder
    || response.folder.assetType !== "character"
    || response.children.some((child) => child.parentFolderId !== assetId)) {
    throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  }
  return response;
}

/** Creates an empty Character Folder (no image) that other Character Assets can then be linked into. */
export function createAssetFolder(requestBody: CreateAssetFolderRequest): Promise<CreateAssetFolderResponse> {
  return request(API_ROUTES.createAssetFolder, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody),
  }, isCreateAssetFolderResponse);
}

/** Links (or, with `parentFolderId: null`, unlinks) an existing Asset as a child of a Character Folder. */
export async function setAssetParentFolder(
  assetId: string,
  requestBody: SetAssetParentFolderRequest,
): Promise<SetAssetParentFolderResponse> {
  const response = await request(API_ROUTES.assetParentFolder(assetId), {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody),
  }, isSetAssetParentFolderResponse);
  if (response.asset.assetId !== assetId) throw new AssetsApiError(MALFORMED.code, MALFORMED.message);
  return response;
}
