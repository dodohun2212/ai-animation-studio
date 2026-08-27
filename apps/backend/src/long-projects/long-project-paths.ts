import * as path from "node:path";

import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { longEpisodeNotFound, longUnsafeId } from "./long-project-api.error.js";

/**
 * Where a Long Project keeps its files, and the only place that knows.
 *
 * Thirteen call sites across this directory each built these two paths for themselves, and they had not stayed
 * the same: some checked the project id before resolving it and some left that to the resolver, one used
 * `path.resolve` with its own containment check while the rest used `path.join` without one, and the episode
 * number was validated by each caller separately — or, in two of them, not before the directory name was built
 * from it. That is the shape D-021 describes, except worse: those five copies were identically wrong, so at
 * least they agreed. These disagreed, which means reading any one of them told you nothing about the others.
 *
 * Validation lives inside rather than beside. An episode directory cannot be named from a number nobody
 * checked, because the only function that names one checks it first — the guarantee is structural instead of a
 * habit every future caller has to be told about.
 */

/** The single directory name. Kept here so a rename is one edit rather than a search. */
export const LONG_STORY_DIRECTORY = "long_story";

/**
 * The Long Project's own directory: `<projectsRoot>/<projectId>/long_story`.
 *
 * `projectsRoot` is a parameter rather than a constant because the archive lives under a different root and is
 * otherwise laid out identically — passing the root keeps that one caller from needing a second function that
 * would then be free to drift from this one.
 *
 * `longUnsafeId()` rather than the short project's `unsafeProjectId()`, which the resolver would raise on its
 * own: both carry the code `UNSAFE_PROJECT_ID` and status 400, so nothing observable changes, and a long-project
 * route answering with a long-project exception is what the rest of this directory already does.
 */
export function longStoryRoot(projectsRoot: string, projectId: string): string {
  if (!isSafeProjectId(projectId)) throw longUnsafeId();
  return path.join(resolveSafeProjectDirectory(projectsRoot, projectId), LONG_STORY_DIRECTORY);
}

/**
 * `Episode07` for 7. Validates, because the whole point of putting this in one place is that no unchecked value
 * can reach a path — a caller holding just the name is one `path.join` away from holding a path.
 */
export function episodeDirectoryName(episodeNumber: number): string {
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1) throw longEpisodeNotFound();
  return `Episode${String(episodeNumber).padStart(2, "0")}`;
}
