import * as path from "node:path";

/**
 * The same path, rebuilt under a learning-data root it was not written under.
 *
 * Stored paths across this app are absolute — the asset index's `stored_path`, a project's `generated_images`,
 * its `generated_video_paths`, a video record's `output_path`. The learning-data root, meanwhile, moves: the
 * desktop shell keeps it in `apps/backend` during development and under `userData` once packaged, and migrates
 * the whole directory across on the first packaged launch (docs/06_DECISIONS.md D-038). Every one of those paths
 * then names a location that no longer exists, while the bytes sit in the same relative place under the new root.
 *
 * The anchor is what keeps this from inventing a location. Only a path that names somewhere *inside* a
 * learning-data root is relocated, and only from the anchor onward; a path from anywhere else is left exactly as
 * it was, so a caller can still tell "this file is gone" from "this file moved with the root".
 *
 * Scanned from the end so the innermost anchor wins: a root that itself sits inside a directory called
 * `projects` would otherwise re-root at the outer one and point at something that is not the file being looked
 * for.
 */
export function reRootedPathCandidates(storedPath: string, learningDataRoot: string, anchors: readonly string[]): string[] {
  if (!path.isAbsolute(storedPath)) return [];
  // Split on both platforms' separators, named rather than written as an escaped character class: a path
  // recorded on Windows is normally read back on Windows, but the files that hold these are plain JSON.
  const segments = storedPath.split(path.win32.sep).flatMap((part) => part.split(path.posix.sep)).filter(Boolean);
  const anchorSet = new Set(anchors);
  const candidates: string[] = [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (anchorSet.has(segments[index]!)) candidates.push(path.resolve(learningDataRoot, ...segments.slice(index)));
  }
  return candidates;
}

/**
 * The one path to use for a stored value: relocated under this root when it names somewhere inside a
 * learning-data root, and otherwise untouched.
 *
 * Deliberately does not check whether the file exists. On the machine that wrote it the relocated path is
 * character-for-character the original, so this is a no-op until a root actually moves; and when one has moved,
 * naming where the file *should* be is more useful than keeping a name that is certainly wrong — a missing file
 * then reads as missing in the right place, which is what a person can act on.
 */
export function reRootedPath(storedPath: string, learningDataRoot: string, anchors: readonly string[]): string {
  return reRootedPathCandidates(storedPath, learningDataRoot, anchors)[0] ?? storedPath;
}
