import * as fs from "node:fs/promises";
import * as path from "node:path";

import { resolveSafeProjectDirectory } from "./project-id.js";

export type MoveDirectory = (source: string, destination: string) => Promise<void>;

/**
 * Moves an exact project directory into a hidden, recoverable subtree of the
 * same projects root. Keeping both paths on the same volume makes rename an
 * atomic directory move; no project content is copied or deleted first.
 */
export async function archiveProjectDirectory(
  projectsRoot: string,
  projectId: string,
  move: MoveDirectory = fs.rename,
): Promise<void> {
  const root = path.resolve(projectsRoot);
  const source = resolveSafeProjectDirectory(root, projectId);
  const archiveRoot = path.resolve(root, ".archive");
  const destination = path.resolve(archiveRoot, projectId);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (!source.startsWith(rootPrefix) || path.dirname(source) !== root
    || !archiveRoot.startsWith(rootPrefix) || path.dirname(destination) !== archiveRoot) {
    throw new Error("unsafe archive path");
  }

  const sourceInfo = await fs.lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error("project directory is unavailable");
  }

  await fs.mkdir(archiveRoot, { recursive: true });
  try {
    await fs.lstat(destination);
    throw new Error("archive destination already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await move(source, destination);
}

export interface ArchivedProjectEntry { projectId: string; archivedAt: string; }

/** Lists the project IDs currently sitting in `<projectsRoot>/.archive`, with each directory's own mtime as an approximate archived-at timestamp. Unreadable entries are silently skipped. */
export async function listArchivedProjectDirectories(projectsRoot: string): Promise<ArchivedProjectEntry[]> {
  const archiveRoot = path.resolve(path.resolve(projectsRoot), ".archive");
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const results: ArchivedProjectEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const stat = await fs.lstat(path.join(archiveRoot, entry.name));
      if (stat.isSymbolicLink()) continue;
      results.push({ projectId: entry.name, archivedAt: stat.mtime.toISOString() });
    } catch { continue; }
  }
  return results;
}

/**
 * Moves an archived project directory back to its original active location.
 * The mirror image of {@link archiveProjectDirectory}: same safety checks,
 * same atomic same-volume rename, opposite direction.
 */
export async function restoreProjectDirectory(
  projectsRoot: string,
  projectId: string,
  move: MoveDirectory = fs.rename,
): Promise<void> {
  const root = path.resolve(projectsRoot);
  const archiveRoot = path.resolve(root, ".archive");
  const source = resolveSafeProjectDirectory(archiveRoot, projectId);
  const destination = resolveSafeProjectDirectory(root, projectId);

  let sourceInfo;
  try {
    sourceInfo = await fs.lstat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("archived project not found");
    throw error;
  }
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error("archived project not found");

  try {
    await fs.lstat(destination);
    throw new Error("restore destination already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await move(source, destination);
}

export type RemoveDirectory = (target: string) => Promise<void>;

/**
 * Permanently deletes an archived project's data from disk. Resolves only
 * inside `<projectsRoot>/.archive`, so — unlike a hypothetical delete keyed
 * on the active project path — it can never reach an active (non-archived)
 * project directory regardless of the ID passed in.
 */
export async function deleteArchivedProjectDirectory(
  projectsRoot: string,
  projectId: string,
  remove: RemoveDirectory = (target) => fs.rm(target, { recursive: true }),
): Promise<void> {
  const root = path.resolve(projectsRoot);
  const archiveRoot = path.resolve(root, ".archive");
  const target = resolveSafeProjectDirectory(archiveRoot, projectId);

  let info;
  try {
    info = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("archived project not found");
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("archived project not found");
  await remove(target);
}
