import { PROJECT_ASSET_MAPPING_REVIEW_STATUSES, ASSET_MAPPING_ASSIGNMENT_SOURCES,
  ASSET_MAPPING_STATUSES,
  ASSET_MAPPING_VERSION_POLICIES,
  API_ROUTES,
  isSceneNumber as isValidSceneNumber,
  isSha256Hex,
  type ApproveProjectAssetMappingReviewRequest,
  type ApproveProjectAssetMappingReviewResponse,
  type AssetMappingAssignmentSource,
  type AssetMappingSceneScope,
  type AssetMappingStatus,
  type AssetMappingVersionPolicy,
  type BeginProjectAssetMappingReviewRequest,
  type BeginProjectAssetMappingReviewResponse,
  type CreateProjectAssetMappingRequest,
  type CreateProjectAssetMappingResponse,
  type GetProjectAssetMappingReviewResponse,
  type ListProjectAssetMappingsResponse,
  type ProjectAssetMapping,
  type ProjectAssetMappingReview,
  type ProjectAssetMappingReviewStatus,
  type SnapshotProjectAssetMappingResponse,
  type UpdateProjectAssetMappingRequest,
  type UpdateProjectAssetMappingResponse,
} from "@ai-animation-studio/shared";
import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

export class MappingsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "MappingsApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요.",
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  ASSET_NOT_FOUND: "에셋을 찾을 수 없습니다.",
  ASSET_MAPPING_NOT_FOUND: "참고 이미지 연결을 찾을 수 없습니다.",
  ASSET_MAPPING_JSON_MALFORMED: "참고 이미지 연결 데이터를 읽을 수 없습니다.",
  ASSET_MAPPING_DATA_INVALID: "참고 이미지 연결 데이터가 올바르지 않습니다.",
  ASSET_MAPPING_REVIEW_MALFORMED: "참고 이미지 연결 검토 데이터를 읽을 수 없습니다.",
  ASSET_MAPPING_REVIEW_INVALID: "참고 이미지 연결 검토 데이터가 올바르지 않습니다.",
  ASSET_MAPPING_APPROVAL_BLOCKED: "아직 다음 단계로 넘어갈 수 없습니다.",
  ASSET_MAPPING_FINGERPRINT_MISMATCH: "대본이 바뀌어서 \"지금 대본 기준으로 다시 맞추기\"를 먼저 눌러야 합니다.",
  ASSET_MAPPING_SNAPSHOT_INVALID: "선택한 이미지 버전으로는 고정본을 만들 수 없습니다.",
  ASSET_MAPPING_STORAGE_ERROR: "참고 이미지 연결을 저장하지 못했습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

/** Never surfaces the backend's raw message or details text — only a fixed, safe message per code. */
export function toMappingDisplayError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (!(error instanceof MappingsApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) {
    const details = error.details;
    return details ? { code: error.code, message: SAFE_ERRORS[error.code]!, details } : { code: error.code, message: SAFE_ERRORS[error.code]! };
  }
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

// The contract's own array — same reason as assetsApi's: this is a response guard, and a status it does not
// know turns a valid response into 서버 응답을 확인할 수 없습니다.
const STATUSES: readonly AssetMappingStatus[] = ASSET_MAPPING_STATUSES;
const SOURCES: readonly AssetMappingAssignmentSource[] = ASSET_MAPPING_ASSIGNMENT_SOURCES;
const POLICIES: readonly AssetMappingVersionPolicy[] = ASSET_MAPPING_VERSION_POLICIES;
const REVIEW_STATUSES: readonly ProjectAssetMappingReviewStatus[] = PROJECT_ASSET_MAPPING_REVIEW_STATUSES;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isSceneNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && isValidSceneNumber(value);
const isSceneNumberArray = (value: unknown): value is number[] => Array.isArray(value) && value.every(isSceneNumber);
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]00:00)$/;
const isUtcIsoTimestamp = (value: unknown): value is string => isString(value) && UTC_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
/* The contract's own check. Retyping the pattern here is how one of nine copies loses its anchors and starts
   accepting a digest with anything appended — a fingerprint comparison that can no longer fail. */
const isDigest = isSha256Hex;
const isVersionNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;

function isSceneScope(value: unknown): value is AssetMappingSceneScope {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "all") return Object.keys(value).length === 1;
  if (value.kind === "scene") return Object.keys(value).length === 2 && isSceneNumber(value.sceneNumber);
  if (value.kind === "range") return Object.keys(value).length === 3 && isSceneNumber(value.startScene) && isSceneNumber(value.endScene) && (value.startScene as number) <= (value.endScene as number);
  if (value.kind === "list") return Object.keys(value).length === 2 && isSceneNumberArray(value.sceneNumbers) && value.sceneNumbers.length > 0;
  return false;
}

function isMapping(value: unknown): value is ProjectAssetMapping {
  if (!isRecord(value)) return false;
  if (!(isString(value.mappingId) && value.mappingId.length > 0)) return false;
  if (!(isString(value.projectId) && value.projectId.length > 0)) return false;
  if (!(isString(value.assetId) && value.assetId.length > 0)) return false;
  if (typeof value.enabled !== "boolean") return false;
  if (!isString(value.usageRole)) return false;
  if (!isSceneScope(value.sceneScope)) return false;
  if (!SOURCES.includes(value.assignmentSource as AssetMappingAssignmentSource)) return false;
  if (!(value.confidence === null || (typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1))) return false;
  if (!isString(value.matchReason)) return false;
  if (!STATUSES.includes(value.status as AssetMappingStatus)) return false;
  if (typeof value.userConfirmed !== "boolean") return false;
  if (!POLICIES.includes(value.versionPolicy as AssetMappingVersionPolicy)) return false;
  if (!(value.pinnedVersion === null || isVersionNumber(value.pinnedVersion))) return false;
  if (typeof value.candidateOnly !== "boolean") return false;
  if (!(isUtcIsoTimestamp(value.createdAt) && isUtcIsoTimestamp(value.updatedAt))) return false;
  if (!(value.snapshot === null || (isRecord(value.snapshot) && isString(value.snapshot.relativePath) && isDigest(value.snapshot.sha256) && isVersionNumber(value.snapshot.sourceVersion)))) return false;
  if (!isStringArray(value.selectedChildAssetIds)) return false;
  return true;
}

function isReview(value: unknown): value is ProjectAssetMappingReview {
  if (!isRecord(value)) return false;
  if (!(isString(value.projectId) && value.projectId.length > 0)) return false;
  if (!(Number.isInteger(value.mappingRevision) && (value.mappingRevision as number) >= 0)) return false;
  if (!(Number.isInteger(value.scriptRevision) && (value.scriptRevision as number) >= 0)) return false;
  if (!isString(value.scriptFingerprint)) return false;
  if (!REVIEW_STATUSES.includes(value.status as ProjectAssetMappingReviewStatus)) return false;
  if (!(value.approvedAt === null || isUtcIsoTimestamp(value.approvedAt))) return false;
  if (!(value.approvedBy === null || isString(value.approvedBy))) return false;
  if (typeof value.textOnlyConfirmed !== "boolean") return false;
  if (typeof value.legacyConfirmed !== "boolean") return false;
  if (!isSceneNumberArray(value.reviewedScenes)) return false;
  return true;
}

const isListResponse = (value: unknown): value is ListProjectAssetMappingsResponse =>
  isRecord(value) && Array.isArray(value.mappings) && value.mappings.every(isMapping);
const isCreateResponse = (value: unknown): value is CreateProjectAssetMappingResponse =>
  isRecord(value) && isMapping(value.mapping);
const isUpdateResponse = (value: unknown): value is UpdateProjectAssetMappingResponse =>
  isRecord(value) && isMapping(value.mapping) && isReview(value.review);
// sceneCount is checked, not assumed. It is what the scene pickers are built from, and a response missing it
// would reach the screen as `undefined` on a field typed `number` — a list built from that is wrong in exactly
// the silent way the field was added to end. Failing the guard turns that into the ordinary malformed-response
// message instead.
const isGetReviewResponse = (value: unknown): value is GetProjectAssetMappingReviewResponse =>
  isRecord(value) && isReview(value.review) && typeof value.sceneCount === "number";
const isBeginReviewResponse = (value: unknown): value is BeginProjectAssetMappingReviewResponse =>
  isRecord(value) && isReview(value.review);
const isApproveReviewResponse = (value: unknown): value is ApproveProjectAssetMappingReviewResponse =>
  isRecord(value) && isReview(value.review);
const isSnapshotResponse = (value: unknown): value is SnapshotProjectAssetMappingResponse =>
  isRecord(value) && isMapping(value.mapping);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toApiErrorShape(body: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)) {
    const details = isRecord(body.details) ? body.details : undefined;
    return details ? { code: body.code, message: body.message, details } : { code: body.code, message: body.message };
  }
  return MALFORMED;
}

async function request<T>(url: string, init: RequestInit | undefined, guard: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try {
    response = init ? await fetch(url, init) : await fetch(url);
  } catch {
    throw new MappingsApiError(NETWORK.code, NETWORK.message);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    // A 5xx that did not even carry the backend's own error shape means the backend never answered — it is
    // down, restarting, or something in front of it replied. Say that, instead of blaming the response body.
    if (isServerUnavailable(response.status, apiError.code)) {
      throw new MappingsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    throw new MappingsApiError(apiError.code, apiError.message, apiError.details);
  }
  if (!guard(body)) throw new MappingsApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

/**
 * Everything the mapping review screen can do, with no mention of who owns the mappings.
 *
 * A short project and a Long Episode run the identical review flow over the identical request/response shapes
 * — the only difference is which URL the calls go to. Handing the screen this object instead of an id is what
 * keeps that true: a screen holding a `projectId` eventually does something else with it, and then the two
 * owners have quietly diverged again. That divergence is exactly what the Long Episode mapping code was: a
 * second, worse implementation of a flow that already existed.
 *
 * (docs/06_DECISIONS.md D-026.)
 *
 * `projectId` + an optional `episodeNumber` was the other option and was deliberately not taken: an optional
 * argument encodes "omit it and you get the short project" as an unwritten rule, and a caller that gets it
 * wrong compiles and runs and silently addresses the wrong owner.
 */
export interface MappingApi {
  /**
   * Stable identity for this owner — used ONLY as a React effect dependency, never parsed or displayed.
   * Without it the screen would have to depend on the adapter's object identity, and a caller that builds the
   * adapter inline (the natural thing to write) would re-fetch on every render forever.
   */
  readonly id: string;
  list(): Promise<ListProjectAssetMappingsResponse>;
  create(requestBody: CreateProjectAssetMappingRequest): Promise<CreateProjectAssetMappingResponse>;
  getReview(): Promise<GetProjectAssetMappingReviewResponse>;
  update(mappingId: string, requestBody: UpdateProjectAssetMappingRequest): Promise<UpdateProjectAssetMappingResponse>;
  beginReview(requestBody: BeginProjectAssetMappingReviewRequest): Promise<BeginProjectAssetMappingReviewResponse>;
  approveReview(requestBody: ApproveProjectAssetMappingReviewRequest): Promise<ApproveProjectAssetMappingReviewResponse>;
  snapshot(mappingId: string): Promise<SnapshotProjectAssetMappingResponse>;
}

interface MappingRoutes {
  id: string;
  mappings: string;
  mapping: (mappingId: string) => string;
  review: string;
  reviewApprove: string;
  snapshot: (mappingId: string) => string;
}

const json = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

function mappingApiFor(routes: MappingRoutes): MappingApi {
  return {
    id: routes.id,
    list: () => request(routes.mappings, undefined, isListResponse),
    /**
     * Links one Asset to this owner's scenes as a reference image.
     *
     * `versionPolicy` is deliberately not sent: the server picks `follow_latest` for a Folder (a Folder has no
     * versions of its own; its bytes come from whichever child is currently its representative) and
     * `pinned_version` for a single image, and it rejects a Folder pinned to a version. Letting the server
     * decide keeps that rule in one place — and it is the rule the Long Episode path never had, which is why
     * a character Folder could be chosen on screen and then refused on save.
     */
    create: (requestBody) => request(routes.mappings, json(requestBody), isCreateResponse),
    getReview: () => request(routes.review, undefined, isGetReviewResponse),
    update: async (mappingId, requestBody) => {
      const response = await request(
        routes.mapping(mappingId),
        { ...json(requestBody), method: "PATCH" },
        isUpdateResponse,
      );
      if (response.mapping.mappingId !== mappingId) throw new MappingsApiError(MALFORMED.code, MALFORMED.message);
      return response;
    },
    beginReview: (requestBody) => request(routes.review, json(requestBody), isBeginReviewResponse),
    approveReview: (requestBody) => request(routes.reviewApprove, json(requestBody), isApproveReviewResponse),
    snapshot: async (mappingId) => {
      const response = await request(routes.snapshot(mappingId), { method: "POST" }, isSnapshotResponse);
      if (response.mapping.mappingId !== mappingId) throw new MappingsApiError(MALFORMED.code, MALFORMED.message);
      return response;
    },
  };
}

/** Mappings owned by a short project. */
export function projectMappingApi(projectId: string): MappingApi {
  return mappingApiFor({
    id: `project:${projectId}`,
    mappings: API_ROUTES.projectAssetMappings(projectId),
    mapping: (mappingId) => API_ROUTES.projectAssetMapping(projectId, mappingId),
    review: API_ROUTES.projectAssetMappingReview(projectId),
    reviewApprove: API_ROUTES.projectAssetMappingReviewApprove(projectId),
    snapshot: (mappingId) => API_ROUTES.projectAssetMappingSnapshot(projectId, mappingId),
  });
}

/** Mappings owned by one Episode of a Long Project — same flow, same shapes, different scope. */
export function episodeMappingApi(projectId: string, episodeNumber: number): MappingApi {
  return mappingApiFor({
    id: `episode:${projectId}:${episodeNumber}`,
    mappings: API_ROUTES.episodeAssetMappings(projectId, episodeNumber),
    mapping: (mappingId) => API_ROUTES.episodeAssetMapping(projectId, episodeNumber, mappingId),
    review: API_ROUTES.episodeAssetMappingReview(projectId, episodeNumber),
    reviewApprove: API_ROUTES.episodeAssetMappingReviewApprove(projectId, episodeNumber),
    snapshot: (mappingId) => API_ROUTES.episodeAssetMappingSnapshot(projectId, episodeNumber, mappingId),
  });
}
