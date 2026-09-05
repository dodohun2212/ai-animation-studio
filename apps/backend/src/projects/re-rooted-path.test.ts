import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { reRootedPath, reRootedPathCandidates } from "./re-rooted-path.js";

const ROOT = path.resolve("/new/learning_data");
const ANCHORS = ["projects", "asset_library"];

/**
 * Rebuilding a stored absolute path under a root it was not written under.
 *
 * Every stored path in this app is absolute — an asset's stored_path, a project's generated_images, a video
 * record's output_path — and the learning-data root moves once, on the first packaged launch (D-038). This is
 * what keeps those paths pointing at the bytes afterwards, and it had no test.
 *
 * The property that matters is not the rebuilding. It is which anchor wins: the doc says the scan runs from the
 * end so the innermost one does, because a root that itself sits under a directory called `projects` would
 * otherwise be re-rooted at the outer one and name a different file. Scanning forward reads more naturally,
 * which is exactly why someone would write it that way.
 */
describe("a stored path rebuilt under a moved root", () => {
  it("relocates from the anchor onward", () => {
    const stored = path.resolve("/old/learning_data/projects/card_one/images/scene1.png");
    expect(reRootedPath(stored, ROOT, ANCHORS)).toBe(path.resolve(ROOT, "projects", "card_one", "images", "scene1.png"));
  });

  it("takes the innermost anchor, not the first one it passes", () => {
    // The case the comment describes: a root nested under a directory that is itself called `projects`. Scanning
    // from the front would rebuild at the outer one and name a file that is not the one being looked for.
    const stored = path.resolve("/old/projects/learning_data/projects/card_one/images/scene1.png");
    expect(reRootedPath(stored, ROOT, ANCHORS)).toBe(path.resolve(ROOT, "projects", "card_one", "images", "scene1.png"));
    // Both are still offered, innermost first, for the caller that wants to try each.
    expect(reRootedPathCandidates(stored, ROOT, ANCHORS)).toHaveLength(2);
  });

  it("leaves a path that names nowhere inside a learning-data root exactly as it was", () => {
    // This is what keeps "this file is gone" distinguishable from "this file moved with the root". Inventing a
    // location for an outside path would answer the wrong question with a confident-looking path.
    const outside = path.resolve("/somewhere/else/holiday.png");
    expect(reRootedPath(outside, ROOT, ANCHORS)).toBe(outside);
    expect(reRootedPathCandidates(outside, ROOT, ANCHORS)).toEqual([]);
  });

  it("offers nothing for a relative path", () => {
    // A relative path is already resolved against the running root; re-rooting it would double the prefix.
    expect(reRootedPathCandidates(path.join("projects", "card_one", "images", "scene1.png"), ROOT, ANCHORS)).toEqual([]);
  });

  it("reads a path recorded with the other platform's separators", () => {
    // These live in plain JSON. A record written on Windows is normally read on Windows, but nothing structural
    // says it must be, and a separator this does not split on makes the anchor invisible.
    const windowsStyle = "C:\\old\\learning_data\\projects\\card_one\\images\\scene1.png";
    expect(reRootedPathCandidates(windowsStyle, ROOT, ANCHORS)[0])
      .toBe(path.resolve(ROOT, "projects", "card_one", "images", "scene1.png"));
  });
});
