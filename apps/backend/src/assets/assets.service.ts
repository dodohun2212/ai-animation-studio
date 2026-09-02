import type {
  AddAssetVersionResponse, AssetType, CharacterFolderReferenceSetRequest, CharacterFolderReferenceSetResponse,
  CreateAssetFolderRequest, CreateAssetFolderResponse, CreateAssetMetadata, CreateAssetResponse,
  DeleteAssetFolderResponse, DeleteAssetOwnedFileResponse, DeleteAssetResponse, GetAssetResponse, ListAssetFileAuditResponse,
  ListAssetsResponse, RelinkAssetResponse, SetAssetParentFolderResponse, UpdateAssetMetadataRequest, UpdateAssetResponse,
} from "@ai-animation-studio/shared";
import { ASSET_TYPES } from "@ai-animation-studio/shared";
import { Injectable } from "@nestjs/common";
import { badAssetRequest, invalidAssetFile } from "./asset-api.error.js";
import { ownershipOf, toPublicAsset } from "./asset.mapper.js";
import { LocalAssetsRepository } from "./assets.repository.js";

/** The contract's own list, not a second copy of it — see ASSET_TYPES for what a second copy costs. */
const TYPES = new Set<AssetType>(ASSET_TYPES);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

@Injectable()
export class AssetsService {
  constructor(private readonly repository: LocalAssetsRepository) {}

  async list(query?: string, assetType?: string): Promise<ListAssetsResponse> {
    if (assetType !== undefined && !TYPES.has(assetType as AssetType)) throw badAssetRequest("Asset type is invalid.");
    const needle = query?.trim().toLocaleLowerCase() ?? "";
    const assets = (await this.repository.listExcludingArchivedProjects())
      .filter((asset) => !assetType || asset.asset_type === assetType)
      .filter((asset) => !needle || [asset.display_name, asset.description, asset.asset_type, ...asset.tags, ...asset.aliases]
        .some((value) => value.toLocaleLowerCase().includes(needle)))
      .sort((left, right) => left.asset_type.localeCompare(right.asset_type) || left.display_name.localeCompare(right.display_name));
    return { assets: assets.map((asset) => toPublicAsset(asset, this.repository.resolveContentPath(asset) !== null)) };
  }

  async get(assetId: string): Promise<GetAssetResponse> {
    const asset = await this.repository.get(assetId);
    const usageProjectIds = await this.repository.usageProjects(assetId);
    const ownership = ownershipOf(asset);
    const canDeleteOwnedFile = usageProjectIds.length === 0 && await this.repository.canDeleteOwnedFile(asset);
    return {
      asset: toPublicAsset(asset, this.repository.resolveContentPath(asset) !== null), usageProjectIds, ownership,
      canDeleteOwnedFile,
    };
  }

  async createMultipart(file: { buffer: Buffer; originalname: string; mimetype?: string } | undefined, body: unknown): Promise<CreateAssetResponse> {
    if (!isObject(body) || Object.keys(body).length !== 1 || !("metadata" in body)) throw badAssetRequest("Multipart form must contain only image and metadata fields.");
    return this.create(file, body.metadata);
  }

  async create(file: { buffer: Buffer; originalname: string; mimetype?: string } | undefined, rawMetadata: unknown): Promise<CreateAssetResponse> {
    if (!file) throw invalidAssetFile("An image file is required.");
    const metadata = this.parseCreateMetadata(rawMetadata);
    const asset = await this.repository.create(file, metadata);
    return { asset: toPublicAsset(asset, this.repository.resolveContentPath(asset) !== null) };
  }

  async update(assetId: string, body: unknown): Promise<UpdateAssetResponse> {
    const changes = this.parseUpdate(body);
    const asset = await this.repository.update(assetId, changes);
    return { asset: toPublicAsset(asset, this.repository.resolveContentPath(asset) !== null) };
  }

  async updateCharacterFolderReferenceSet(assetId: string, body: unknown): Promise<CharacterFolderReferenceSetResponse> {
    const request = this.parseCharacterFolderReferenceSet(body);
    const updated = await this.repository.updateCharacterFolderReferenceSet(assetId, request);
    return {
      folder: toPublicAsset(updated.folder, false),
      children: updated.children.map((asset) => toPublicAsset(asset, this.repository.resolveContentPath(asset) !== null)),
    };
  }

  async createFolder(body: unknown): Promise<CreateAssetFolderResponse> {
    const request = this.parseCreateFolder(body);
    const folder = await this.repository.createFolder(request);
    return { asset: toPublicAsset(folder, false) };
  }

  async setParentFolder(assetId: string, body: unknown): Promise<SetAssetParentFolderResponse> {
    const parentFolderId = this.parseSetParentFolder(body);
    const updated = await this.repository.setParentFolder(assetId, parentFolderId);
    return {
      asset: toPublicAsset(updated.asset, this.repository.resolveContentPath(updated.asset) !== null),
      folder: updated.folder ? toPublicAsset(updated.folder, false) : null,
    };
  }

  async remove(assetId: string): Promise<DeleteAssetResponse> {
    await this.repository.remove(assetId);
    return { assetId, deletedOwnedFile: false };
  }

  async addVersion(assetId: string, file: { buffer: Buffer; originalname: string; mimetype?: string } | undefined, rawNotes: unknown): Promise<AddAssetVersionResponse> {
    if (!file) throw invalidAssetFile("An image file is required.");
    const notes = this.parseNotes(rawNotes);
    const asset = await this.repository.addVersion(assetId, file, notes);
    return { asset: toPublicAsset(asset, this.repository.resolveContentPath(asset) !== null) };
  }

  async relink(assetId: string, file: { buffer: Buffer; originalname: string; mimetype?: string } | undefined): Promise<RelinkAssetResponse> {
    if (!file) throw invalidAssetFile("An image file is required.");
    const asset = await this.repository.relink(assetId, file);
    return { asset: toPublicAsset(asset, this.repository.resolveContentPath(asset) !== null) };
  }

  async audit(): Promise<ListAssetFileAuditResponse> {
    return { entries: await this.repository.auditFiles() };
  }

  async removeOwnedFile(assetId: string): Promise<DeleteAssetOwnedFileResponse> {
    await this.repository.removeOwnedFile(assetId);
    return { assetId, deletedOwnedFile: true };
  }

  async removeFolder(assetId: string, rawRemoveChildIndexes?: string, rawDeleteManualFiles?: string): Promise<DeleteAssetFolderResponse> {
    const removeChildIndexes = this.parseBooleanFlag(rawRemoveChildIndexes, "removeChildIndexes");
    const deleteManualFiles = this.parseBooleanFlag(rawDeleteManualFiles, "deleteManualFiles");
    const result = await this.repository.removeFolder(assetId, { removeChildIndexes, deleteManualFiles });
    return { assetId, removedChildAssetIds: result.removedChildAssetIds, deletedFiles: result.deletedFiles };
  }

  private parseBooleanFlag(raw: string | undefined, name: string): boolean {
    if (raw === undefined) return false;
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw badAssetRequest(`${name} must be "true" or "false".`);
  }

  private parseNotes(raw: unknown): string {
    if (raw === undefined || raw === null || raw === "") return "";
    if (typeof raw !== "string" || raw.length > 2000) throw badAssetRequest("Version notes are invalid.");
    return raw;
  }

  async content(assetId: string): Promise<{ path: string; extension: string }> {
    const asset = await this.repository.get(assetId);
    const contentPath = asset.is_folder
      ? await this.repository.resolveFolderRepresentativeContentPath(asset)
      : this.repository.resolveContentPath(asset);
    if (!contentPath) throw invalidAssetFile("Asset image is unavailable.");
    const extension = contentPath.slice(contentPath.lastIndexOf(".")).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) throw invalidAssetFile("Asset image format is unavailable.");
    return { path: contentPath, extension };
  }

  private parseCreateMetadata(raw: unknown): CreateAssetMetadata {
    let value: unknown = raw;
    if (typeof raw === "string") {
      try { value = JSON.parse(raw); } catch { throw badAssetRequest("Asset metadata is not valid JSON."); }
    }
    if (!isObject(value)) throw badAssetRequest("Asset metadata is required.");
    const allowed = new Set(["assetType", "displayName", "description", "tags", "aliases", "approved", "faceBaseline", "characterKey", "notes"]);
    if (Object.keys(value).some((key) => !allowed.has(key)) || !TYPES.has(value.assetType as AssetType)
      || typeof value.displayName !== "string" || !value.displayName.trim() || value.displayName.trim().length > 200
      || !(value.description === undefined || typeof value.description === "string") || !(value.tags === undefined || isStrings(value.tags))
      || !(value.aliases === undefined || isStrings(value.aliases)) || !(value.approved === undefined || typeof value.approved === "boolean")
      || !(value.faceBaseline === undefined || typeof value.faceBaseline === "boolean")
      || !(value.characterKey === undefined || value.characterKey === null || typeof value.characterKey === "string")
      || !(value.notes === undefined || typeof value.notes === "string")) throw badAssetRequest("Asset metadata is invalid.");
    if (value.faceBaseline === true && value.assetType !== "character") throw badAssetRequest("Face baseline requires a character asset.");
    return value as unknown as CreateAssetMetadata;
  }

  private parseUpdate(value: unknown): UpdateAssetMetadataRequest {
    if (!isObject(value)) throw badAssetRequest("Update payload is invalid.");
    const allowed = new Set(["assetType", "displayName", "description", "tags", "aliases", "approved", "faceBaseline", "characterKey", "notes", "role"]);
    if (Object.keys(value).length === 0 || Object.keys(value).some((key) => !allowed.has(key))
      || !(value.assetType === undefined || TYPES.has(value.assetType as AssetType))
      || !(value.displayName === undefined || (typeof value.displayName === "string" && value.displayName.trim() && value.displayName.trim().length <= 200))
      || !(value.description === undefined || typeof value.description === "string") || !(value.tags === undefined || isStrings(value.tags))
      || !(value.aliases === undefined || isStrings(value.aliases)) || !(value.approved === undefined || typeof value.approved === "boolean")
      || !(value.faceBaseline === undefined || typeof value.faceBaseline === "boolean")
      || !(value.characterKey === undefined || value.characterKey === null || typeof value.characterKey === "string")
      || !(value.notes === undefined || typeof value.notes === "string") || !(value.role === undefined || typeof value.role === "string"))
      throw badAssetRequest("Update payload is invalid.");
    return value as UpdateAssetMetadataRequest;
  }

  private parseCharacterFolderReferenceSet(value: unknown): CharacterFolderReferenceSetRequest {
    if (!isObject(value) || Object.keys(value).length !== 2 || !isStrings(value.childAssetIds)
      || typeof value.thumbnailAssetId !== "string" || !value.thumbnailAssetId) {
      throw badAssetRequest("Character Folder reference set payload is invalid.");
    }
    return { childAssetIds: value.childAssetIds, thumbnailAssetId: value.thumbnailAssetId };
  }

  private parseCreateFolder(raw: unknown): CreateAssetFolderRequest {
    if (!isObject(raw)) throw badAssetRequest("Folder metadata is required.");
    const allowed = new Set(["assetType", "displayName", "description", "notes"]);
    if (Object.keys(raw).some((key) => !allowed.has(key)) || !TYPES.has(raw.assetType as AssetType)
      || typeof raw.displayName !== "string" || !raw.displayName.trim() || raw.displayName.trim().length > 200
      || !(raw.description === undefined || typeof raw.description === "string")
      || !(raw.notes === undefined || typeof raw.notes === "string")) throw badAssetRequest("Folder metadata is invalid.");
    return raw as unknown as CreateAssetFolderRequest;
  }

  private parseSetParentFolder(value: unknown): string | null {
    if (!isObject(value) || Object.keys(value).length !== 1 || !("parentFolderId" in value)
      || !(value.parentFolderId === null || (typeof value.parentFolderId === "string" && value.parentFolderId.length > 0))) {
      throw badAssetRequest("Character Folder parent payload is invalid.");
    }
    return value.parentFolderId as string | null;
  }
}
