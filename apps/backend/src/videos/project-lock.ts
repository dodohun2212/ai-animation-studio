import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * A real Runway task-creation POST resolves in low single-digit seconds even under poor network conditions; this
 * gives a wide margin before a lock is considered abandoned by a dead holder, while staying far short of
 * RUNWAY_TASK_TIMEOUT_SECONDS (900s) for a whole running task — only the submit-and-persist step is guarded here.
 */
const STALE_LOCK_MS = 60_000;
const ACQUIRE_RETRY_MS = 50;
const ACQUIRE_TIMEOUT_MS = 10_000;

export class ProjectLockTimeoutError extends Error {
  constructor(key: string) { super(`Timed out waiting for project lock: ${key}`); }
}

/**
 * Cross-process exclusive lock via atomic `wx`-flag file creation, scoped by `key` (e.g. `${projectId}:${jobId}`).
 * The in-memory `advancing` Set in LocalVideoWorkflowService only ever serializes calls within one Node process —
 * `apps/backend`'s dev script is `nest start --watch`, which restarts the process on every backend file save, and
 * the old and new process can both be alive for a brief overlapping window. In that window each process has its
 * own empty `advancing` Set, so both can read the same "created" scene and both submit it to Runway — a real,
 * separately-billed duplicate task neither process's own polling ever notices (`.claude-bridge` Round 152: a
 * confirmed incident, $3.00 actually charged against $2.00 our ledger recorded, three scenes submitted twice each
 * within the same second). A lock file, unlike an in-memory Set, is visible to both processes.
 */
export async function withProjectLock<T>(projectDirectory: string, key: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = path.join(projectDirectory, `.lock-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
  await fs.mkdir(projectDirectory, { recursive: true });
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      await fs.writeFile(lockFile, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await isStale(lockFile)) { await fs.rm(lockFile, { force: true }).catch(() => undefined); continue; }
      if (Date.now() > deadline) throw new ProjectLockTimeoutError(key);
      await new Promise((resolve) => setTimeout(resolve, ACQUIRE_RETRY_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockFile, { force: true }).catch(() => undefined);
  }
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
