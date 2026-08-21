// Mirrors the Backend's project ID allow-list (Unicode letters/numbers plus
// `_`/`-`, matching Python's `str.isalnum()`). This is a fast-fail UX check
// only — the Backend re-validates and is the source of truth.
const SAFE_PROJECT_ID_PATTERN = /^[\p{L}\p{N}_-]+$/u;

export function isSafeProjectId(projectId: string): boolean {
  return SAFE_PROJECT_ID_PATTERN.test(projectId);
}
