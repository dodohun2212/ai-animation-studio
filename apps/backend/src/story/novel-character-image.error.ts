import { HttpException, HttpStatus } from "@nestjs/common";
import { BUDGET_LEDGER_UNREADABLE_CODE, type ApiError } from "@ai-animation-studio/shared";

type Code = "NOVEL_CHARACTER_IMAGE_INVALID_REQUEST" | "NOVEL_CHARACTER_IMAGE_PROMPT_STALE"
  | "NOVEL_CHARACTER_IMAGE_KEY_MISSING" | "NOVEL_CHARACTER_IMAGE_BUDGET_EXCEEDED"
  | "NOVEL_CHARACTER_IMAGE_ALREADY_ATTEMPTED" | "NOVEL_CHARACTER_IMAGE_STORAGE_ERROR"
  | "NOVEL_CHARACTER_IMAGE_PROVIDER_ERROR" | typeof BUDGET_LEDGER_UNREADABLE_CODE;

function error(code: Code, message: string, status: HttpStatus, details?: Record<string, unknown>): HttpException {
  const body: ApiError = details ? { code, message, details } : { code, message };
  return new HttpException(body, status);
}

export const novelCharacterImageInvalid = () => error("NOVEL_CHARACTER_IMAGE_INVALID_REQUEST", "인물 이미지 요청을 확인해 주세요.", HttpStatus.BAD_REQUEST);
export const novelCharacterImageStale = () => error("NOVEL_CHARACTER_IMAGE_PROMPT_STALE", "인물 설명이 미리보기 뒤 바뀌었습니다. 새 미리보기를 확인해 주세요.", HttpStatus.CONFLICT);
export const novelCharacterImageKeyMissing = () => error("NOVEL_CHARACTER_IMAGE_KEY_MISSING", "OpenAI 키를 저장하고 연결한 뒤 이미지를 만드세요.", HttpStatus.CONFLICT);
export const novelCharacterImageBudgetExceeded = (message: string) => error("NOVEL_CHARACTER_IMAGE_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const novelCharacterImageAlreadyAttempted = () => error("NOVEL_CHARACTER_IMAGE_ALREADY_ATTEMPTED", "이 인물 이미지 요청은 이미 전송됐을 수 있습니다. 중복 과금을 막기 위해 다시 보내지 않았습니다.", HttpStatus.CONFLICT);
export const novelCharacterImageStorageError = (requestSent: boolean, spendUnrecorded = false, recoveryImageBase64?: string) =>
  error("NOVEL_CHARACTER_IMAGE_STORAGE_ERROR", "생성된 인물 이미지를 보관함에 저장하지 못했습니다.", HttpStatus.INTERNAL_SERVER_ERROR,
    { requestSent, spendUnrecorded, ...(recoveryImageBase64 ? { recoveryImageBase64 } : {}) });
export const novelCharacterImageProviderError = (category: string, message: string, spendUnrecorded: boolean, providerMessage?: string, providerRequestId?: string) =>
  error("NOVEL_CHARACTER_IMAGE_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY,
    { category, spendUnrecorded, ...(providerMessage ? { providerMessage } : {}), ...(providerRequestId ? { providerRequestId } : {}) });
export const novelCharacterImageLedgerUnreadable = () => error(BUDGET_LEDGER_UNREADABLE_CODE, "OpenAI 사용 기록을 읽을 수 없어 유료 요청을 보내지 않았습니다.", HttpStatus.CONFLICT);
