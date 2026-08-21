import type {
  AssetType, CreateAssetMetadata, CreateAssetResponse, DeleteAssetResponse, GetAssetResponse,
  ListAssetsResponse, UpdateAssetMetadataRequest, UpdateAssetResponse,
} from "@ai-animation-studio/shared";
import { Injectable } from "@nestjs/common";
import { badAssetRequest, invalidAssetFile } from "./asset-api.error.js";
import { ownershipOf, toPublicAsset } from "./asset.mapper.js";
import { LocalAssetsRepository } from "./assets.repository.js";

const TYPES = new Set<AssetType>(["character", "style", "background", "object", "general_reference"]);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

@Injectable()
export class AssetsService {
  constructor(private readonly repository: LocalAssetsRepository) {}

  async list(query?: string, assetType?: string): Promise<ListAssetsResponse> {
    if (assetType !== undefined && !TYPES.has(assetType as AssetType)) throw badAssetRequest("Asset type is invalid.");
    const needle = query?.trim().toLocaleLowerCase() ?? "";
    const assets = (await this.repository.list())
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

  async remove(assetId: string): Promise<DeleteAssetResponse> {
    await this.repository.remove(assetId);
    return { assetId, deletedOwnedFile: false };
  }

  async content(assetId: string): Promise<{ path: string; extension: string }> {
    const asset = await this.repository.get(assetId);
    const contentPath = this.repository.resolveContentPath(asset);
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
}
