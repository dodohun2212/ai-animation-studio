import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { SAFE_PROJECT_ID_PATTERN, resolveProjectPath } from "./project-path.ts";

const desktopRoot = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const backendProjectId = path.join(desktopRoot, "..", "backend", "src", "projects", "project-id.ts");

/** The Backend's own literal, read out of its source rather than imported — see project-path.ts's comment. */
function backendPattern(): RegExp {
  const source = fs.readFileSync(backendProjectId, "utf8");
  const match = /const SAFE_PROJECT_ID_PATTERN = \/(.+)\/([a-z]*);/.exec(source);
  assert.ok(match, "the Backend no longer declares SAFE_PROJECT_ID_PATTERN the way this check reads it");
  return new RegExp(match[1]!, match[2]!);
}

/**
 * Which project folder names this app will open, held to the Backend's answer.
 *
 * `project-path.ts` carries a hand-written copy of the Backend's allow-list with a comment saying it mirrors it.
 * A comment is not a check. This app has no dependency on the Backend — gaining one would change what the
 * installer carries — so the mirror is verified instead of shared.
 *
 * The direction this fails in matters: the allow-list is one half of a path-traversal refusal, and a copy that
 * drifts wide opens a folder the Backend itself would refuse to serve. It would drift silently, because both
 * sides keep passing their own tests.
 */
describe("the project-id allow-list this app opens folders by", () => {
  it("is the same expression the Backend refuses folders by", () => {
    const backend = backendPattern();
    assert.equal(SAFE_PROJECT_ID_PATTERN.source, backend.source);
    assert.equal(SAFE_PROJECT_ID_PATTERN.flags, backend.flags);
  });

  it("answers the same for the names that decide whether a path escapes", () => {
    // Source equality is the strict half; this is the half that says what the expression is for. Unicode
    // letters are accepted because the Python baseline accepted them, and every separator and dot is not.
    const backend = backendPattern();
    for (const name of ["project_1", "이배드", "a-b", "..", ".", "a/b", "a\\b", "", " a", "a ", "C:", "a.b", "*"]) {
      assert.equal(SAFE_PROJECT_ID_PATTERN.test(name), backend.test(name), `disagreed about ${JSON.stringify(name)}`);
    }
  });

  it("refuses to resolve anything outside the project folder it was given", () => {
    // The other half of the refusal, kept here beside the allow-list it depends on: an id the pattern accepts
    // must still not reach outside its own directory through the relative path.
    const root = path.resolve("/projects");
    assert.equal(resolveProjectPath(root, "..", "images"), undefined);
    assert.equal(resolveProjectPath(root, "good", path.join("..", "..", "secrets.json")), undefined);
    assert.equal(resolveProjectPath(root, "good", "videos/final/instagram_reel.mp4"),
      path.resolve(root, "good", "videos/final/instagram_reel.mp4"));
  });
});
