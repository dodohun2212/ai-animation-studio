import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

export type ProviderSettingsErrorCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_PROVIDER"
  | "INVALID_CREDENTIAL"
  | "INVALID_BUDGET_LIMIT"
  | "UNKNOWN_VIDEO_MODEL"
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
/**
  * Said as its own code, not folded into INVALID_REQUEST.
  *
  * This is the one settings value a person types in their own units, and the refusal has to name the rule or it
  * reads as the app rejecting a perfectly ordinary number. Zero is refused on purpose: "spend nothing" is what
  * disconnecting the provider already says, and a limit of zero is indistinguishable on every other screen from
  * a budget that has been used up.
  */
export const invalidBudgetLimit = (): ProviderSettingsException =>
  new ProviderSettingsException("INVALID_BUDGET_LIMIT", "월 한도는 0보다 큰 금액이어야 합니다.", HttpStatus.BAD_REQUEST);
/** A model this app cannot price must never reach a budget check — so an unrecognised one is refused, not defaulted. */
export const unknownVideoModel = (): ProviderSettingsException =>
  new ProviderSettingsException("UNKNOWN_VIDEO_MODEL", "고를 수 없는 영상 모델입니다.", HttpStatus.BAD_REQUEST);
export const credentialNotConfigured = (): ProviderSettingsException =>
  new ProviderSettingsException("CREDENTIAL_NOT_CONFIGURED", "No saved credential is available for this provider.", HttpStatus.CONFLICT);
export const settingsFileMalformed = (): ProviderSettingsException =>
  new ProviderSettingsException("SETTINGS_FILE_MALFORMED", "The local settings file cannot be safely read.", HttpStatus.INTERNAL_SERVER_ERROR);
export const settingsStorageError = (): ProviderSettingsException =>
  new ProviderSettingsException("SETTINGS_STORAGE_ERROR", "The local settings file could not be updated.", HttpStatus.INTERNAL_SERVER_ERROR);
