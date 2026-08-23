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
