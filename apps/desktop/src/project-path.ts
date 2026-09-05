import * as path from "node:path";

/**
 * Mirrors apps/backend/src/projects/project-id.ts's allow-list so a folder resolved here always matches
 * what the Backend itself would resolve.
 *
 * Exported for project-id-allowlist.test.ts, which reads the Backend's literal out of its source and
 * compares the two. This app cannot import the Backend's copy — it has no dependency on the workspace and
 * gaining one would change what the installer has to carry — so the mirror is checked instead of shared.
 * Without that check the comment above is the only thing holding the two together, and the direction it
 * fails in is a folder the Backend refuses to open being opened here.
 */
export const SAFE_PROJECT_ID_PATTERN = /^[\p{L}\p{N}_-]+$/u;

function isSafeProjectId(projectId: string): boolean {
  return SAFE_PROJECT_ID_PATTERN.test(projectId);
}

function withTrailingSep(directory: string): string {
  return directory.endsWith(path.sep) ? directory : directory + path.sep;
}

/**
 * Resolves a project-relative path for "open in file explorer" IPC requests,
 * refusing anything that is not a well-formed project ID or that would
 * resolve outside that project's own folder under `projectsRoot`.
 */
export function resolveProjectPath(projectsRoot: string, projectId: string, relativePath?: string): string | undefined {
  if (!isSafeProjectId(projectId)) return undefined;
  const resolvedRoot = path.resolve(projectsRoot);
  const projectDirectory = path.resolve(resolvedRoot, projectId);
  if (!projectDirectory.startsWith(withTrailingSep(resolvedRoot))) return undefined;
  if (!relativePath) return projectDirectory;
  const target = path.resolve(projectDirectory, relativePath);
  if (target !== projectDirectory && !target.startsWith(withTrailingSep(projectDirectory))) return undefined;
  return target;
}
