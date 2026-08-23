import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

export type AssetErrorCode =
  | "INVALID_REQUEST"
  | "UNSAFE_ASSET_ID"
  | "ASSET_NOT_FOUND"
  | "ASSET_ALREADY_EXISTS"
  | "ASSET_IN_USE"
  | "ASSET_MUTATION_UNSUPPORTED"
  | "ASSET_VERSION_DUPLICATE"
  | "ASSET_JSON_MALFORMED"
  | "ASSET_DATA_INVALID"
  | "ASSET_FILE_INVALID"
  | "ASSET_STORAGE_ERROR";

export class AssetApiException extends HttpException {
  constructor(code: AssetErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
    super(body, status);
  }
}

export const badAssetRequest = (message: string) =>
  new AssetApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST);
export const unsafeAssetId = () =>
  new AssetApiException("UNSAFE_ASSET_ID", "Asset ID is invalid.", HttpStatus.BAD_REQUEST);
export const assetNotFound = () =>
  new AssetApiException("ASSET_NOT_FOUND", "Asset was not found.", HttpStatus.NOT_FOUND);
export const assetInUse = () =>
  new AssetApiException("ASSET_IN_USE", "Asset is used by one or more projects.", HttpStatus.CONFLICT);
export const assetMutationUnsupported = () =>
  new AssetApiException("ASSET_MUTATION_UNSUPPORTED", "Folder and folder-child mutation is not supported in this migration step.", HttpStatus.CONFLICT);
export const assetVersionDuplicate = () =>
  new AssetApiException("ASSET_VERSION_DUPLICATE", "This version is already registered.", HttpStatus.CONFLICT);
export const malformedAssetIndex = () =>
  new AssetApiException("ASSET_JSON_MALFORMED", "Asset Library metadata is not valid JSON.", HttpStatus.INTERNAL_SERVER_ERROR);
export const invalidAssetData = () =>
  new AssetApiException("ASSET_DATA_INVALID", "Asset Library metadata is invalid.", HttpStatus.INTERNAL_SERVER_ERROR);
export const invalidAssetFile = (message = "Image file is invalid.") =>
  new AssetApiException("ASSET_FILE_INVALID", message, HttpStatus.BAD_REQUEST);
export const assetStorageError = () =>
  new AssetApiException("ASSET_STORAGE_ERROR", "Asset Library storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR);
