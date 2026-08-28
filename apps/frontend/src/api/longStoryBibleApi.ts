import {
  API_ROUTES,
  type CreateLongStoryBibleItemRequest,
  type CreateLongStoryBibleItemResponse,
  type DeleteLongStoryBibleItemResponse,
  type DuplicateLongStoryBibleItemResponse,
  type GetLongProjectStoryBibleResponse,
  type LongStoryBible,
  type LongStoryBibleCollection,
  type LongStoryBibleItem,
  type LongStoryBibleStyleAssetLink,
  type SearchLongStoryBibleItemsResponse,
  type UpdateLongStoryBibleContentRequest,
  type UpdateLongStoryBibleContentResponse,
  type UpdateLongStoryBibleItemRequest,
  type UpdateLongStoryBibleItemResponse,
  type UpdateLongStoryBibleProtagonistAssetLinkRequest,
  type UpdateLongStoryBibleProtagonistAssetLinkResponse,
  type UpdateLongStoryBibleStyleAssetLinkRequest,
  type UpdateLongStoryBibleStyleAssetLinkResponse,
} from "@ai-animation-studio/shared";

export class LongStoryBibleApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LongStoryBibleApiError";
    this.code = code;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  INVALID_REQUEST: "입력 내용을 확인해 주세요.",
  UNSAFE_PROJECT_ID: "프로젝트 ID가 올바르지 않습니다.",
  LONG_PROJECT_NOT_FOUND: "장기 프로젝트를 찾을 수 없습니다.",
  LONG_PROJECT_JSON_MALFORMED: "장기 프로젝트 데이터를 읽을 수 없습니다.",
  LONG_PROJECT_DATA_INVALID: "장기 프로젝트 데이터가 올바르지 않습니다.",
  LONG_PROJECT_STORAGE_ERROR: "장기 프로젝트 저장소에 접근할 수 없습니다.",
  STORY_BIBLE_ITEM_NOT_FOUND: "스토리 바이블 항목을 찾을 수 없습니다.",
  STORY_BIBLE_ITEM_ALREADY_EXISTS: "같은 ID의 스토리 바이블 항목이 이미 있습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결할 수 없습니다." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };

export function toLongStoryBibleDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof LongStoryBibleApiError)) return UNKNOWN;
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) return { code: error.code, message: SAFE_ERRORS[error.code]! };
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  return UNKNOWN;
}

const COLLECTIONS: readonly LongStoryBibleCollection[] = ["secrets", "foreshadowing"];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

function isStyleAssetLink(value: unknown): value is LongStoryBibleStyleAssetLink {
  return isRecord(value) && isString(value.assetId) && value.assetId.trim().length > 0
    && (value.versionPolicy === "pinned_version" || value.versionPolicy === "follow_latest" || value.versionPolicy === "snapshot")
    && Number.isInteger(value.pinnedVersion) && (value.pinnedVersion as number) >= 1;
}

function isItem(value: unknown): value is LongStoryBibleItem {
  if (!isRecord(value) || !isString(value.id) || !value.id.trim()) return false;
  return ["name", "status", "description"].every((key) => value[key] === undefined || isString(value[key]))
    && (value.revealAvailableEpisode === undefined
      || (typeof value.revealAvailableEpisode === "number" && Number.isInteger(value.revealAvailableEpisode)));
}

function isStoryBible(value: unknown): value is LongStoryBible {
  if (!isRecord(value) || !isRecord(value.basic) || !isRecord(value.world) || !isString(value.updatedAt)) return false;
  return (value.styleAssetLink === undefined || isStyleAssetLink(value.styleAssetLink))
    && COLLECTIONS.every((collection) => Array.isArray(value[collection]) && value[collection].every(isItem));
}

const isGetResponse = (value: unknown): value is GetLongProjectStoryBibleResponse => isRecord(value) && isStoryBible(value.storyBible);
const isContentResponse = (value: unknown): value is UpdateLongStoryBibleContentResponse => isRecord(value) && isStoryBible(value.storyBible);
const isStyleAssetLinkResponse = (value: unknown): value is UpdateLongStoryBibleStyleAssetLinkResponse => isRecord(value) && isStoryBible(value.storyBible);
const isProtagonistAssetLinkResponse = (value: unknown): value is UpdateLongStoryBibleProtagonistAssetLinkResponse => isRecord(value) && isStoryBible(value.storyBible);
const isCreateResponse = (value: unknown): value is CreateLongStoryBibleItemResponse => isRecord(value) && isItem(value.item) && isStoryBible(value.storyBible);
const isUpdateResponse = (value: unknown): value is UpdateLongStoryBibleItemResponse => isRecord(value) && isItem(value.item) && isStoryBible(value.storyBible);
const isDeleteResponse = (value: unknown): value is DeleteLongStoryBibleItemResponse => isRecord(value) && isStoryBible(value.storyBible);
const isSearchResponse = (value: unknown): value is SearchLongStoryBibleItemsResponse => isRecord(value) && Array.isArray(value.items) && value.items.every(isItem);
const isDuplicateResponse = (value: unknown): value is DuplicateLongStoryBibleItemResponse => isRecord(value) && isItem(value.item) && isStoryBible(value.storyBible);

async function request<T>(url: string, init: RequestInit | undefined, guard: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try { response = init ? await fetch(url, init) : await fetch(url); }
  catch { throw new LongStoryBibleApiError(NETWORK.code, NETWORK.message); }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const code = isRecord(body) && isString(body.code) && body.code.trim() ? body.code : MALFORMED.code;
    throw new LongStoryBibleApiError(code, SAFE_ERRORS[code] ?? UNKNOWN.message);
  }
  if (!guard(body)) throw new LongStoryBibleApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

export function getLongProjectStoryBible(projectId: string): Promise<GetLongProjectStoryBibleResponse> {
  return request(API_ROUTES.longProjectStoryBible(projectId), undefined, isGetResponse);
}

export function updateLongStoryBibleContent(projectId: string, body: UpdateLongStoryBibleContentRequest): Promise<UpdateLongStoryBibleContentResponse> {
  return request(API_ROUTES.longProjectStoryBibleContent(projectId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, isContentResponse);
}

export function updateLongStoryBibleStyleAssetLink(projectId: string, body: UpdateLongStoryBibleStyleAssetLinkRequest): Promise<UpdateLongStoryBibleStyleAssetLinkResponse> {
  return request(API_ROUTES.longProjectStoryBibleStyleAssetLink(projectId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, isStyleAssetLinkResponse);
}

/**
 * The one character that belongs to the whole work, stored beside the style reference in `basic`.
 *
 * `null` clears it, the same way the style link does — one shape for the two project-wide references rather
 * than a second convention for the second one.
 */
export function updateLongStoryBibleProtagonistAssetLink(projectId: string, body: UpdateLongStoryBibleProtagonistAssetLinkRequest): Promise<UpdateLongStoryBibleProtagonistAssetLinkResponse> {
  return request(API_ROUTES.longProjectStoryBibleProtagonistAssetLink(projectId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, isProtagonistAssetLinkResponse);
}

export function createLongStoryBibleItem(projectId: string, collection: LongStoryBibleCollection, body: CreateLongStoryBibleItemRequest): Promise<CreateLongStoryBibleItemResponse> {
  return request(API_ROUTES.longProjectStoryBibleCollection(projectId, collection), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, isCreateResponse);
}

export function updateLongStoryBibleItem(projectId: string, collection: LongStoryBibleCollection, itemId: string, body: UpdateLongStoryBibleItemRequest): Promise<UpdateLongStoryBibleItemResponse> {
  return request(API_ROUTES.longProjectStoryBibleItem(projectId, collection, itemId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, isUpdateResponse);
}

export function deleteLongStoryBibleItem(projectId: string, collection: LongStoryBibleCollection, itemId: string): Promise<DeleteLongStoryBibleItemResponse> {
  return request(API_ROUTES.longProjectStoryBibleItem(projectId, collection, itemId), { method: "DELETE" }, isDeleteResponse);
}

export function searchLongStoryBibleItems(projectId: string, collection: LongStoryBibleCollection, query: string): Promise<SearchLongStoryBibleItemsResponse> {
  return request(API_ROUTES.longProjectStoryBibleSearch(projectId, collection, query), undefined, isSearchResponse);
}

export function duplicateLongStoryBibleItem(projectId: string, collection: LongStoryBibleCollection, itemId: string): Promise<DuplicateLongStoryBibleItemResponse> {
  return request(API_ROUTES.longProjectStoryBibleDuplicate(projectId, collection, itemId), { method: "POST" }, isDuplicateResponse);
}
