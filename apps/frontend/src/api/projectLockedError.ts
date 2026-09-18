/**
 * One code, one sentence, defined once.
 *
 * `PROJECT_LOCKED` is the single code every backend module sends when a project's work is already in flight —
 * `image-api.error.ts:44` says so in as many words, and `story-prompt.service.ts:226` and
 * `local-image-generation.service.ts:160` repeat it (docs/06_DECISIONS.md D-005). Six API modules on this side
 * render it, and the house habit for a shared code is to repeat the sentence word for word with a comment
 * saying so. That habit is what this constant replaces, for the reason `budgetLedgerError.ts` gives: repeating
 * reads fine while someone is comparing two lines today, and this sentence has to stay identical as new locked
 * paths are added.
 *
 * 🔴 It did not stay identical. Five modules carried the sentence below; `videoWorkflowApi.ts` carried
 * 「다른 창에서 이 프로젝트를 처리하는 중입니다」 — and that clause is usually false. The lock's real holders are
 * a timer tick advancing the job, a concurrent GET poll, and the old and new backend process overlapping across
 * a `nest start --watch` restart (`project-lock.ts`, D-005). Every one of those happens with exactly one window
 * open. The server's own message says **process** ("Another process is currently advancing this project's video
 * generation.", `video-workflow-api.error.ts:49`); only the translation said window, and it sent a person off to
 * hunt for a second tab that was not there.
 *
 * 🔴 The second half is the half that guards money, and it is why this is a constant rather than a tidy-up.
 * The generic fallback this code exists to replace — "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." —
 * tells the reader to press the button again, and pressing it again is the double submission the lock exists to
 * prevent: the one that charged $3.00 twice on 2026-09-05 (docs/06_DECISIONS.md D-010). So the sentence says the
 * opposite in plain words, and then says the wait resolves itself, so that not-pressing does not read as
 * being stuck.
 *
 * A module with something genuinely different to say still says it — `archiveApi.ts` does exactly that for
 * `PROJECT_NOT_FOUND`, because a stale list has its own remedy ("목록을 새로고침해 주세요"). What this constant
 * ends is the *accidental* difference: six copies of one sentence, one of which drifted into a claim about the
 * user's windows that nothing in the system can support.
 */
export const PROJECT_LOCKED_MESSAGE =
  "이 프로젝트에서 다른 작업이 진행 중입니다. 다시 누르지 마세요 — 그 작업이 끝나면 자동으로 반영됩니다.";
