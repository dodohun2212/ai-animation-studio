import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * How long a lock file may go untouched before another arrival treats its holder as dead and reclaims it.
 *
 * This is a liveness question, not a duration limit: a live holder refreshes the file every HEARTBEAT_MS, so
 * "untouched for a minute" means the process that wrote it is gone. Without that refresh the constant would
 * silently double as a cap on how long guarded work may take — which is wrong for every caller whose guarded
 * work is a provider call. An outline generation measured on 2026-08-27 took over 22 seconds, and generating
 * narration is one TTS call per scene, so a cap would be exceeded by exactly the slow calls people press twice.
 */
const STALE_LOCK_MS = 60_000;
const ACQUIRE_RETRY_MS = 50;
const ACQUIRE_TIMEOUT_MS = 10_000;
/** Comfortably inside STALE_LOCK_MS, so a live holder is never mistaken for a dead one even if a refresh is missed. */
const HEARTBEAT_MS = 15_000;

export class ProjectLockTimeoutError extends Error {
  constructor(key: string) { super(`Timed out waiting for project lock: ${key}`); }
}

/**
 * Cross-process exclusive lock via atomic `wx`-flag file creation, scoped by `key` (e.g. `${projectId}:${jobId}`).
 * The in-memory `advancing` Set in LocalVideoWorkflowService only ever serializes calls within one Node process —
 * `apps/backend`'s dev script is `nest start --watch`, which restarts the process on every backend file save, and
 * the old and new process can both be alive for a brief overlapping window. In that window each process has its
 * own empty `advancing` Set, so both can read the same "created" scene and both submit it to Runway — a real,
 * separately-billed duplicate task neither process's own polling ever notices (docs/06_DECISIONS.md D-005).
 * A lock file, unlike an in-memory Set, is visible to both processes.
 */
export async function withProjectLock<T>(projectDirectory: string, key: string, fn: () => Promise<T>, options?: { timeoutMs?: number; heartbeatMs?: number }): Promise<T> {
  const lockFile = path.join(projectDirectory, `.lock-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
  // Identifies this holder specifically, so refreshing and releasing can tell "my lock" from "a lock". Without
  // it, a holder whose file was reclaimed as stale would keep a stranger's lock alive with its refreshes and
  // then delete it on the way out, releasing work that is still running.
  const token = crypto.randomUUID();
  await fs.mkdir(projectDirectory, { recursive: true });
  // Overridable for two reasons. A test can exercise the timeout path in milliseconds instead of really waiting
  // ACQUIRE_TIMEOUT_MS out; and a caller whose second arrival has nothing useful to do after waiting can pass 0
  // to be refused at once. Waiting is right when the holder finishes in seconds and the work still needs doing
  // — it is pure delay when the holder's own completion is what will make this call invalid anyway (see
  // LongProjectsService.approve).
  const deadline = Date.now() + (options?.timeoutMs ?? ACQUIRE_TIMEOUT_MS);
  for (;;) {
    try {
      await fs.writeFile(lockFile, JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() }), { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await isStale(lockFile)) { await fs.rm(lockFile, { force: true }).catch(() => undefined); continue; }
      if (Date.now() > deadline) throw new ProjectLockTimeoutError(key);
      await new Promise((resolve) => setTimeout(resolve, ACQUIRE_RETRY_MS));
    }
  }
  // Say "still here" for as long as the work runs. Overridable so a test need not wait real seconds for a beat.
  const heartbeat = setInterval(() => { void refresh(lockFile, token); }, options?.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    if (await heldBy(lockFile, token)) await fs.rm(lockFile, { force: true }).catch(() => undefined);
  }
}

/** Whether the lock file still belongs to this holder — false once it has been reclaimed and rewritten by someone else. */
async function heldBy(lockFile: string, token: string): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(lockFile, "utf8"));
    return typeof parsed === "object" && parsed !== null && (parsed as { token?: unknown }).token === token;
  } catch {
    // Unreadable or already gone. Either way there is nothing of ours left to protect or release.
    return false;
  }
}

async function refresh(lockFile: string, token: string): Promise<void> {
  if (!(await heldBy(lockFile, token))) return;
  const now = new Date();
  await fs.utimes(lockFile, now, now).catch(() => undefined);
}

async function isStale(lockFile: string): Promise<boolean> {
  try {
    const stat = await fs.stat(lockFile);
    return Date.now() - stat.mtimeMs > STALE_LOCK_MS;
  } catch {
    // Vanished between our EEXIST and this stat (the holder released it) — safe to retry immediately.
    return true;
  }
}
