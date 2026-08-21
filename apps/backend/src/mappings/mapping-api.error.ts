import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

export type MappingErrorCode =
  | "INVALID_REQUEST"
  | "PROJECT_NOT_FOUND"
  | "ASSET_NOT_FOUND"
  | "ASSET_MAPPING_NOT_FOUND"
  | "ASSET_MAPPING_JSON_MALFORMED"
  | "ASSET_MAPPING_DATA_INVALID"
  | "ASSET_MAPPING_REVIEW_MALFORMED"
  | "ASSET_MAPPING_REVIEW_INVALID"
  | "ASSET_MAPPING_APPROVAL_BLOCKED"
  | "ASSET_MAPPING_FINGERPRINT_MISMATCH"
  | "ASSET_MAPPING_SNAPSHOT_INVALID"
  | "ASSET_MAPPING_STORAGE_ERROR";

export class MappingApiException extends HttpException {
  constructor(code: MappingErrorCode, message: string, status: HttpStatus, details?: Record<string, unknown>) {
    const body: ApiError = details ? { code, message, details } : { code, message };
    super(body, status);
  }
}

export const invalidMappingRequest = (message: string, details?: Record<string, unknown>) =>
  new MappingApiException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST, details);
export const mappingProjectNotFound = () =>
  new MappingApiException("PROJECT_NOT_FOUND", "Project was not found.", HttpStatus.NOT_FOUND);
export const mappingAssetNotFound = () =>
  new MappingApiException("ASSET_NOT_FOUND", "Asset was not found.", HttpStatus.NOT_FOUND);
export const mappingNotFound = () =>
  new MappingApiException("ASSET_MAPPING_NOT_FOUND", "Project Asset Mapping was not found.", HttpStatus.NOT_FOUND);
export const malformedMappings = () =>
  new MappingApiException("ASSET_MAPPING_JSON_MALFORMED", "Project Asset Mapping data is not valid JSON.", HttpStatus.INTERNAL_SERVER_ERROR);
export const invalidMappings = () =>
  new MappingApiException("ASSET_MAPPING_DATA_INVALID", "Project Asset Mapping data is invalid.", HttpStatus.INTERNAL_SERVER_ERROR);
export const malformedReview = () =>
  new MappingApiException("ASSET_MAPPING_REVIEW_MALFORMED", "Asset Mapping review data is not valid JSON.", HttpStatus.INTERNAL_SERVER_ERROR);
export const invalidReview = () =>
  new MappingApiException("ASSET_MAPPING_REVIEW_INVALID", "Asset Mapping review data is invalid.", HttpStatus.INTERNAL_SERVER_ERROR);
export const approvalBlocked = (message: string, details?: Record<string, unknown>) =>
  new MappingApiException("ASSET_MAPPING_APPROVAL_BLOCKED", message, HttpStatus.CONFLICT, details);
export const fingerprintMismatch = () =>
  new MappingApiException("ASSET_MAPPING_FINGERPRINT_MISMATCH", "The script changed, so Asset Mapping approval must be reviewed again.", HttpStatus.CONFLICT);
export const snapshotInvalid = () =>
  new MappingApiException("ASSET_MAPPING_SNAPSHOT_INVALID", "The selected Asset version cannot be snapshotted.", HttpStatus.CONFLICT);
export const mappingStorageError = () =>
  new MappingApiException("ASSET_MAPPING_STORAGE_ERROR", "Project Asset Mapping storage operation failed.", HttpStatus.INTERNAL_SERVER_ERROR);
