import assert from "node:assert/strict";
import { test } from "node:test";
import * as path from "node:path";
import { resolveProjectPath } from "./project-path.ts";

const ROOT = path.join("C:", "learning_data", "projects");

test("resolves the project's own folder when no relative path is given", () => {
  assert.equal(resolveProjectPath(ROOT, "고양이-project_1"), path.join(ROOT, "고양이-project_1"));
});

test("resolves a nested relative path inside the project folder", () => {
  assert.equal(
    resolveProjectPath(ROOT, "demo", "videos/final/instagram_reel.mp4"),
    path.join(ROOT, "demo", "videos", "final", "instagram_reel.mp4"),
  );
});

test("rejects a project ID with disallowed characters", () => {
  assert.equal(resolveProjectPath(ROOT, "../escape"), undefined);
  assert.equal(resolveProjectPath(ROOT, "demo/../../escape"), undefined);
  assert.equal(resolveProjectPath(ROOT, ""), undefined);
});

test("rejects a relative path that escapes the project folder", () => {
  assert.equal(resolveProjectPath(ROOT, "demo", "../other-project/secret.txt"), undefined);
  assert.equal(resolveProjectPath(ROOT, "demo", "..\\..\\other-project"), undefined);
});

/**
 * The highest-consequence input this function takes, and the one nothing was pinning.
 *
 * Whatever comes back from here is handed to the shell to open. A relative path is checked for escaping with
 * "..", but an absolute one does not need to escape — path.resolve simply discards the base and returns it. The
 * containment check below catches that today; without a test, a refactor that compared the *relative* string
 * instead of the resolved one would open anything on the machine and every existing assertion would still pass.
 */
test("rejects an absolute or UNC path, which does not need \"..\" to leave the project", () => {
  assert.equal(resolveProjectPath(ROOT, "demo", path.join("C:", "Windows", "System32")), undefined);
  assert.equal(resolveProjectPath(ROOT, "demo", "/etc/passwd"), undefined);
  assert.equal(resolveProjectPath(ROOT, "demo", "\\server\share\secret.txt"), undefined);
});

/** The Episode shape the merge screen now sends: one more level than the short project, and still inside. */
test("resolves an Episode's final video, which sits two directories deeper", () => {
  assert.equal(
    resolveProjectPath(ROOT, "demo", "long_story/Episode01/videos/final/instagram_reel.mp4"),
    path.join(ROOT, "demo", "long_story", "Episode01", "videos", "final", "instagram_reel.mp4"),
  );
});
