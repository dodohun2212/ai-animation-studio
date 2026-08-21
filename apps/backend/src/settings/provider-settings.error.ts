import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

export type ProviderSettingsErrorCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_PROVIDER"
  | "INVALID_CREDENTIAL"
  | "CREDENTIAL_NOT_CONFIGURED"
  | "SETTINGS_FILE_MALFORMED"
  | "SETTINGS_STORAGE_ERROR";

export class ProviderSettingsException extends HttpException {
  constructor(code: ProviderSettingsErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
    super(body, status);
  }
}

export const invalidSettingsRequest = (message: string): ProviderSettingsException =>
  new ProviderSettingsException("INVALID_REQUEST", message, HttpStatus.BAD_REQUEST);
export const unknownProvider = (): ProviderSettingsException =>
  new ProviderSettingsException("UNKNOWN_PROVIDER", "The provider must be openai or runway.", HttpStatus.BAD_REQUEST);
export const invalidCredential = (): ProviderSettingsException =>
  new ProviderSettingsException("INVALID_CREDENTIAL", "Credential must be at least 20 characters with no whitespace.", HttpStatus.BAD_REQUEST);
export const credentialNotConfigured = (): ProviderSettingsException =>
  new ProviderSettingsException("CREDENTIAL_NOT_CONFIGURED", "No saved credential is available for this provider.", HttpStatus.CONFLICT);
export const settingsFileMalformed = (): ProviderSettingsException =>
  new ProviderSettingsException("SETTINGS_FILE_MALFORMED", "The local settings file cannot be safely read.", HttpStatus.INTERNAL_SERVER_ERROR);
export const settingsStorageError = (): ProviderSettingsException =>
  new ProviderSettingsException("SETTINGS_STORAGE_ERROR", "The local settings file could not be updated.", HttpStatus.INTERNAL_SERVER_ERROR);
