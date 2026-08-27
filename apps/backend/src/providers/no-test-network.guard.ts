/**
 * Hard refusal of a real network call to a paid provider (Runway, OpenAI) from a test process. Checks the
 * resolved `fetchImpl` that is actually about to be called — a vitest mock function (`vi.fn()`, whether passed
 * explicitly as `fetchImpl` or installed via `vi.stubGlobal("fetch", ...)`, both patterns used across this
 * codebase's tests) exposes a `.mock` property the real, native `fetch` never does. Anything that reaches here
 * with a plain, unmocked `fetch` while running under vitest is about to hit the real API with whatever real
 * credential happens to sit on disk at `process.cwd()`-relative paths (`ProviderSettingsModule`'s own default) —
 * refuse it outright instead of letting it silently go out. docs/06_DECISIONS.md D-016: real, unexplained Runway
 * charges (four tasks, ~$1.00, no trace in any project.json or budget ledger) traced to exactly this gap — a real
 * backend API key sitting at `apps/backend/.env` (process.cwd()'s default) with nothing structurally stopping a
 * test process's real `fetch` from reaching it.
 */
export function assertRealNetworkCallAllowed(providerName: string, fetchImpl: typeof fetch): void {
  if (!process.env.VITEST && process.env.NODE_ENV !== "test") return;
  if (typeof fetchImpl === "function" && "mock" in fetchImpl) return;
  throw new Error(
    `Refusing a real ${providerName} network call from a test process (fetch is not a mock). ` +
    "Pass an explicit fetchImpl mock, or vi.stubGlobal(\"fetch\", ...), before this call.",
  );
}
