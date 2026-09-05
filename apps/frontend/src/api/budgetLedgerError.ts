/**
 * One code, one sentence, defined once.
 *
 * Behind it is a single fact — the usage ledger on disk could not be read, so nothing knows what this month has
 * cost — and the server refuses every paid request until that is fixed. The refusal can reach the person
 * through more than one screen's API module, and those modules keep separate message tables on purpose. Where
 * two of them already share a server code the house habit is to repeat the sentence word for word with a
 * comment saying so (imageReviewApi's PROJECT_LOCKED). Repeating reads fine when a person is comparing two
 * lines today; this one has to stay identical as new paid paths are added, so it is a constant instead.
 *
 * The last sentence is the one that earns its place. An unreadable ledger does not heal by waiting, and the
 * generic fallback this code exists to replace — "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." —
 * sends the reader to press a button that cannot succeed until a file is fixed. A code with no label is worse
 * than no code at all here, which is why the label lands before the server starts sending the code.
 */
export { BUDGET_LEDGER_UNREADABLE_CODE as BUDGET_LEDGER_UNREADABLE } from "@ai-animation-studio/shared";
export const BUDGET_LEDGER_UNREADABLE_MESSAGE =
  "사용 기록 파일을 읽을 수 없어 이번 달 사용액을 확인하지 못했습니다. 확인하기 전에는 유료 요청을 보내지 않습니다. 다시 눌러도 같은 결과이니 파일을 확인해 주세요.";
