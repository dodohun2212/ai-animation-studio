import * as path from "node:path";

import { unsafeProjectId } from "./project-api.error.js";

// Mirrors Python's `character.isalnum() or character in "_-"` check used by
// ProjectContext.project_directory_name / MemoryManager.project_directory,
// which accepts any Unicode letter or number, not just ASCII.
const SAFE_PROJECT_ID_PATTERN = /^[\p{L}\p{N}_-]+$/u;

export function isSafeProjectId(projectId: string): boolean {
  return SAFE_PROJECT_ID_PATTERN.test(projectId);
}

/**
 * Resolve a project ID to its storage directory, rejecting anything that
 * is empty, uses disallowed characters, or would resolve outside `root`
 * (defense in depth on top of the character allowlist above).
 */
export function resolveSafeProjectDirectory(root: string, projectId: string): string {
  if (!isSafeProjectId(projectId)) {
    throw unsafeProjectId();
  }
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, projectId);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (candidate !== path.join(resolvedRoot, projectId) || !candidate.startsWith(rootWithSep)) {
    throw unsafeProjectId();
  }
  return candidate;
}
