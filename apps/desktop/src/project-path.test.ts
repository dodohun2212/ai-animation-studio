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
