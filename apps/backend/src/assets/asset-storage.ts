import { MAX_SCENE_COUNT, type AssetStatus, type AssetType } from "@ai-animation-studio/shared";
import { isSafeAssetId } from "./asset-id.js";

export interface StoredAssetVersion { version: number; stored_path: string; content_sha256: string; created_at: string; notes: string }
export interface StoredReferenceImage { role: string; path: string; content_sha256: string; original_filename: string }
export interface StoredAsset {
  asset_id: string; asset_type: AssetType; display_name: string; description: string;
  stored_path: string; original_filename: string; content_sha256: string;
  tags: string[]; aliases: string[]; enabled: boolean; approved: boolean;
  face_baseline: boolean; character_key: string | null; version: number;
  versions: StoredAssetVersion[]; created_at: string; updated_at: string; notes: string;
  legacy_asset_ids: string[]; status: AssetStatus; source_project_id: string;
  source_scene_number: number | null; reference_images: StoredReferenceImage[];
  reference_roles: string[]; is_folder: boolean; parent_folder_id: string;
  child_asset_ids: string[]; thumbnail_asset_id: string; role: string; sort_order: number;
}

const TYPES = new Set(["character", "style", "background", "object", "general_reference"]);
const STATUSES = new Set(["generated", "approved", "rejected", "replaced", "missing", "manual"]);
const FIELDS = new Set([
  "asset_id", "asset_type", "display_name", "description", "stored_path", "original_filename", "content_sha256",
  "tags", "aliases", "enabled", "approved", "face_baseline", "character_key", "version", "versions", "created_at",
  "updated_at", "notes", "legacy_asset_ids", "status", "source_project_id", "source_scene_number", "reference_images",
  "reference_roles", "is_folder", "parent_folder_id", "child_asset_ids", "thumbnail_asset_id", "role", "sort_order",
]);
const REQUIRED = ["asset_id", "asset_type", "display_name", "stored_path", "original_filename", "content_sha256"];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const timestamp = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const safePathText = (value: unknown, allowEmpty = false) => typeof value === "string" && (allowEmpty || value.length > 0) && !/[\0\r\n]/u.test(value);
const safeFilename = (value: unknown) => typeof value === "string" && value.length <= 255
  && !/[\0\r\n/\\]/u.test(value) && value !== "." && value !== "..";
const safeRole = (value: unknown) => typeof value === "string" && value.trim() === value && value.length >= 1 && value.length <= 40 && !/[\0\r\n\t]/u.test(value);

export function parseAssetIndex(value: unknown): StoredAsset[] {
  if (!Array.isArray(value)) throw new Error("root");
  const ids = new Set<string>();
  return value.map((raw) => {
    if (!isObject(raw) || Object.keys(raw).some((key) => !FIELDS.has(key)) || REQUIRED.some((key) => !(key in raw))) throw new Error("shape");
    const item: Record<string, unknown> = {
      description: "", tags: [], aliases: [], approved: false, face_baseline: false,
      character_key: null, version: 1, versions: [], created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
      notes: "", legacy_asset_ids: [], status: "manual", source_project_id: "", source_scene_number: null,
      reference_images: [], reference_roles: [], is_folder: false, parent_folder_id: "", child_asset_ids: [],
      thumbnail_asset_id: "", role: "", sort_order: 0, ...raw, enabled: true,
    };
    if (typeof item.asset_id !== "string" || !isSafeAssetId(item.asset_id) || ids.has(item.asset_id) || typeof item.asset_type !== "string" || !TYPES.has(item.asset_type)
      || typeof item.display_name !== "string" || !item.display_name.trim() || typeof item.description !== "string"
      || !safePathText(item.stored_path, Boolean(item.is_folder)) || typeof item.original_filename !== "string" || typeof item.content_sha256 !== "string"
      || !strings(item.tags) || !strings(item.aliases) || typeof item.enabled !== "boolean" || typeof item.approved !== "boolean"
      || typeof item.face_baseline !== "boolean" || !(item.character_key === null || typeof item.character_key === "string")
      || !Number.isInteger(item.version) || (item.version as number) < 1 || !Array.isArray(item.versions)
      || !timestamp(item.created_at) || !timestamp(item.updated_at) || typeof item.notes !== "string" || !strings(item.legacy_asset_ids)
      || typeof item.status !== "string" || !STATUSES.has(item.status) || typeof item.source_project_id !== "string"
      || !(item.source_scene_number === null || (Number.isInteger(item.source_scene_number) && Number(item.source_scene_number) >= 1 && Number(item.source_scene_number) <= MAX_SCENE_COUNT))
      || !Array.isArray(item.reference_images) || !strings(item.reference_roles) || typeof item.is_folder !== "boolean"
      || typeof item.parent_folder_id !== "string" || !strings(item.child_asset_ids) || typeof item.thumbnail_asset_id !== "string"
      || typeof item.role !== "string" || !Number.isInteger(item.sort_order)) throw new Error("types");
    item.versions = (item.versions as unknown[]).map((version) => {
      if (!isObject(version) || Object.keys(version).some((key) => !["version", "stored_path", "content_sha256", "created_at", "notes"].includes(key))
        || !Number.isInteger(version.version) || Number(version.version) < 1 || !safePathText(version.stored_path) || !digest(version.content_sha256)
        || !timestamp(version.created_at) || typeof version.notes !== "string") throw new Error("version");
      return version as unknown as StoredAssetVersion;
    });
    item.reference_images = item.reference_images.map((image) => {
      if (!isObject(image) || Object.keys(image).some((key) => !["role", "path", "content_sha256", "original_filename"].includes(key))
        || !safeRole(image.role) || !safePathText(image.path)) throw new Error("reference");
      const normalized = { content_sha256: "", original_filename: "", ...image };
      if (!(normalized.content_sha256 === "" || digest(normalized.content_sha256)) || !safeFilename(normalized.original_filename)) throw new Error("reference");
      return normalized as unknown as StoredReferenceImage;
    });
    // Genuine early Python indexes can predate explicit version history. Keep
    // the stable Asset ID and bytes, synthesize only the current in-memory
    // version, and never rewrite the legacy JSON during a read.
    if (!item.is_folder && (item.versions as StoredAssetVersion[]).length === 0
      && safePathText(item.stored_path) && digest(item.content_sha256)) {
      item.versions = [{
        version: item.version as number,
        stored_path: item.stored_path as string,
        content_sha256: item.content_sha256 as string,
        created_at: item.created_at as string,
        notes: "",
      }];
    }
    if (item.asset_type === "character" && !item.is_folder && (item.reference_images as StoredReferenceImage[]).length === 0) {
      item.reference_images = ["thumbnail", "front"].map((role) => ({
        role, path: item.stored_path as string, content_sha256: item.content_sha256 as string,
        original_filename: item.original_filename as string,
      }));
      if ((item.reference_roles as string[]).length === 0) {
        item.reference_roles = ["back", "expression", "front", "left45", "other", "right45", "side", "thumbnail"];
      }
    }
    if (item.face_baseline && item.asset_type !== "character") throw new Error("face");
    if (item.is_folder && ((item.versions as StoredAssetVersion[]).length > 0 || item.stored_path || (item.reference_images as StoredReferenceImage[]).length > 0)) throw new Error("folder file");
    if (item.is_folder && item.thumbnail_asset_id && !(item.child_asset_ids as string[]).includes(item.thumbnail_asset_id as string)) throw new Error("folder thumbnail");
    if (item.asset_type !== "character" && ((item.reference_images as StoredReferenceImage[]).length > 0 || (item.reference_roles as string[]).length > 0)) throw new Error("references");
    if ((item.reference_images as StoredReferenceImage[]).some((image) => !(item.reference_roles as string[]).includes(image.role))) throw new Error("reference role");
    if (!item.is_folder && (item.versions as StoredAssetVersion[]).length === 0) throw new Error("versions");
    const versionNumbers = (item.versions as StoredAssetVersion[]).map((version) => version.version);
    if (new Set(versionNumbers).size !== versionNumbers.length) throw new Error("duplicate version");
    const current = (item.versions as StoredAssetVersion[]).find((version) => version.version === item.version);
    const currentMatchesVersion = current !== undefined && current.stored_path === item.stored_path && current.content_sha256 === item.content_sha256;
    const currentMatchesCharacterReference = item.asset_type === "character" && (item.reference_images as StoredReferenceImage[]).some(
      (image) => image.path === item.stored_path && image.content_sha256 === item.content_sha256,
    );
    if (!item.is_folder && (!current || !item.stored_path || !digest(item.content_sha256)
      || (!currentMatchesVersion && !currentMatchesCharacterReference))) throw new Error("current version");
    ids.add(item.asset_id);
    return item as unknown as StoredAsset;
  });
}
