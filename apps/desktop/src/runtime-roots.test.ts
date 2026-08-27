import assert from "node:assert/strict";
import { test } from "node:test";
import * as path from "node:path";
import { resolveRuntimeRoots } from "./runtime-roots.ts";

const DEV = { packaged: false, userDataPath: path.join("C:", "users", "u", "AppData", "Roaming", "AI Animation Studio"), currentDirectory: path.join("C:", "repo", "apps", "desktop", "dist") };
const PACKAGED = { ...DEV, packaged: true };

test("in development both roots sit in apps/backend, where the dev server already puts them", () => {
  const roots = resolveRuntimeRoots(DEV);
  assert.equal(roots.providerSettingsRoot, path.join("C:", "repo", "apps", "backend"));
  assert.equal(roots.learningDataRoot, path.join("C:", "repo", "apps", "backend", "learning_data"));
});

test("in development the learning-data root is never the repository root", () => {
  // That directory holds the preserved Python baseline; an app pointed at it reads, and eventually writes, data
  // this project is required to leave untouched.
  const roots = resolveRuntimeRoots(DEV);
  assert.notEqual(roots.learningDataRoot, path.join("C:", "repo", "learning_data"));
});

test("when packaged both roots sit under userData, which is writable", () => {
  const roots = resolveRuntimeRoots(PACKAGED);
  assert.equal(roots.providerSettingsRoot, PACKAGED.userDataPath);
  assert.equal(roots.learningDataRoot, path.join(PACKAGED.userDataPath, "learning_data"));
});

test("the two roots are always decided together, so they cannot drift apart", () => {
  // The bug this replaces was one root being passed explicitly and the other left to fall back to the launching
  // process's working directory, which differed between the browser dev server and the desktop shell.
  for (const input of [DEV, PACKAGED]) {
    const roots = resolveRuntimeRoots(input);
    assert.ok(roots.learningDataRoot.startsWith(roots.providerSettingsRoot));
  }
});
