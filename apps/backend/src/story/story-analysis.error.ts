import { HttpException, HttpStatus } from "@nestjs/common";
import { BUDGET_LEDGER_UNREADABLE_CODE, type ApiError } from "@ai-animation-studio/shared";

type Code = "STORY_ANALYSIS_INVALID_REQUEST" | "STORY_ANALYSIS_PROMPT_STALE" | "STORY_ANALYSIS_KEY_MISSING"
  | "STORY_ANALYSIS_BUDGET_EXCEEDED" | "STORY_ANALYSIS_ALREADY_ATTEMPTED" | "STORY_ANALYSIS_STORAGE_ERROR"
  | "STORY_ANALYSIS_PROVIDER_ERROR" | typeof BUDGET_LEDGER_UNREADABLE_CODE;

function error(code: Code, message: string, status: HttpStatus, details?: Record<string, unknown>): HttpException {
  const body: ApiError = details ? { code, message, details } : { code, message };
  return new HttpException(body, status);
}

export const storyAnalysisInvalidRequest = () => error("STORY_ANALYSIS_INVALID_REQUEST", "이야기 분석 요청을 확인해 주세요.", HttpStatus.BAD_REQUEST);
export const storyAnalysisPromptStale = () => error("STORY_ANALYSIS_PROMPT_STALE", "입력 내용이 미리보기 뒤 바뀌었습니다. 새 미리보기를 확인해 주세요.", HttpStatus.CONFLICT);
export const storyAnalysisKeyMissing = () => error("STORY_ANALYSIS_KEY_MISSING", "OpenAI 키를 저장하고 연결한 뒤 분석을 진행해 주세요.", HttpStatus.CONFLICT);
export const storyAnalysisBudgetExceeded = (message: string) => error("STORY_ANALYSIS_BUDGET_EXCEEDED", message, HttpStatus.CONFLICT);
export const storyAnalysisAlreadyAttempted = () => error("STORY_ANALYSIS_ALREADY_ATTEMPTED", "이 입력은 이미 분석을 시작했거나 완료했습니다. 비용이 중복될 수 있어 다시 보내지 않았습니다.", HttpStatus.CONFLICT);
export const storyAnalysisStorageError = (requestSent: boolean, spendUnrecorded = false) => error("STORY_ANALYSIS_STORAGE_ERROR", "이야기 분석 기록을 저장하지 못했습니다.", HttpStatus.INTERNAL_SERVER_ERROR, { requestSent, spendUnrecorded });
export const storyAnalysisProviderError = (category: string, message: string, spendUnrecorded = false) => error("STORY_ANALYSIS_PROVIDER_ERROR", message, HttpStatus.BAD_GATEWAY, { category, spendUnrecorded });
export const storyAnalysisLedgerUnreadable = () => error(BUDGET_LEDGER_UNREADABLE_CODE, "OpenAI 사용 기록을 읽을 수 없어 유료 요청을 보내지 않았습니다.", HttpStatus.CONFLICT);
