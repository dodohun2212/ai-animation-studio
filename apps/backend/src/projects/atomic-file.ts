import * as crypto from "node:crypto";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";

export interface AtomicWriteDeps {
  writeFile: typeof fsPromises.writeFile;
  rename: typeof fsPromises.rename;
  unlink: typeof fsPromises.unlink;
}

const defaultDeps: AtomicWriteDeps = {
  writeFile: fsPromises.writeFile,
  rename: fsPromises.rename,
  unlink: fsPromises.unlink,
};

// Windows/OneDrive can transiently lock a just-written file (antivirus scan,
// sync client). Retry only these specific errors, a small bounded number of
// times, instead of retrying forever or retrying unrelated failures.
const RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const MAX_RENAME_ATTEMPTS = 3;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/**
 * Write UTF-8 content to `finalPath` atomically: write to a unique temp file
 * in the same directory, then rename it into place. Everything from the
 * write through the final rename attempt is covered by one try/finally: if
 * writeFile fails outright, fails after producing partial temp content, or
 * every rename attempt is exhausted, the temp file is removed so no partial
 * `finalPath` and no leftover temp file are ever left behind. A
 * successfully renamed `finalPath` is never touched by the cleanup step.
 */
export async function atomicWriteUtf8File(
  finalPath: string,
  content: string,
  deps: AtomicWriteDeps = defaultDeps,
): Promise<void> {
  const tempPath = path.join(
    path.dirname(finalPath),
    `.${path.basename(finalPath)}.${crypto.randomUUID()}.tmp`,
  );
  let renamed = false;
  try {
    await deps.writeFile(tempPath, content, "utf8");

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RENAME_ATTEMPTS; attempt += 1) {
      try {
        await deps.rename(tempPath, finalPath);
        renamed = true;
        return;
      } catch (error) {
        lastError = error;
        const code = errorCode(error);
        if (!code || !RETRYABLE_CODES.has(code) || attempt === MAX_RENAME_ATTEMPTS) {
          break;
        }
        await delay(25 * attempt);
      }
    }
    throw lastError;
  } finally {
    if (!renamed) {
      await deps.unlink(tempPath).catch(() => undefined);
    }
  }
}
