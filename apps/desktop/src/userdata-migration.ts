export interface UserDataMigrationDeps {
  pathExists: (target: string) => Promise<boolean>;
  rename: (from: string, to: string) => Promise<void>;
  copyRecursive: (from: string, to: string) => Promise<void>;
  mkdirForFile: (target: string) => Promise<void>;
  /** Best-effort delete of a directory tree; only ever called on the staging folder this module itself makes. */
  removeRecursive: (target: string) => Promise<void>;
}

/**
 * Moves an existing packaged install's userData folder from Electron's default (the raw npm package name, which
 * nests unusably on Windows as `%APPDATA%\@ai-animation-studio\desktop`) to a name a user can actually find — see
 * main.ts's call site for the real incident this came from. Never destructive: does nothing when there is
 * nothing at oldPath, and never touches oldPath when something already exists at newPath (a previous migration
 * already ran, or this happens to already be a fresh install at the new name) — always leans toward leaving data
 * exactly where it is over guessing.
 */
export async function migrateUserDataFolder(oldPath: string, newPath: string, deps: UserDataMigrationDeps): Promise<void> {
  if (oldPath === newPath) return;
  if (!(await deps.pathExists(oldPath))) return;
  if (await deps.pathExists(newPath)) return;
  try {
    await deps.rename(oldPath, newPath);
  } catch {
    // Cross-device (different drive) rename fails on every platform — fall back to copying, and deliberately
    // never delete oldPath afterward even on success: a partial or failed copy must never look like data loss.
    //
    // Copied into a staging folder and renamed into place, never written at newPath directly. A copy that
    // fails partway used to leave a half-populated newPath, and the check above then reads it on the next
    // launch as "a previous migration already ran" — so the app opens on partial data while the whole of it
    // sits untouched at oldPath. The bytes were never lost; what the person saw was missing projects. This
    // way newPath either does not exist or is complete, and a failed attempt simply runs again next time.
    // The final rename is within the same folder as newPath, so it cannot hit the cross-device case itself.
    const staging = `${newPath}.migrating`;
    await deps.mkdirForFile(newPath);
    await deps.removeRecursive(staging);
    try {
      await deps.copyRecursive(oldPath, staging);
      await deps.rename(staging, newPath);
    } catch (error) {
      await deps.removeRecursive(staging).catch(() => undefined);
      throw error;
    }
  }
}
