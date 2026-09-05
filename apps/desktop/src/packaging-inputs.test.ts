import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const desktopRoot = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = path.join(desktopRoot, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  build: { files: string[]; extraResources: { from: string; to: string }[] };
};

/** Every directory the installer copies out of this repository, as electron-builder names it. */
function shippedSources(): string[] {
  return [
    ...manifest.build.files.map((pattern) => pattern.replace(/\/\*+.*$/, "")),
    ...manifest.build.extraResources.map((resource) => resource.from),
  ];
}

/** Build outputs — the ones .gitignore keeps out, so a clean checkout does not have them. */
function ignoredOutputDirectories(): Set<string> {
  return new Set(
    fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.endsWith("/") && !line.startsWith("#") && !line.startsWith("!"))
      .map((line) => line.slice(0, -1)),
  );
}

describe("packaging ships what it just built", () => {
  /**
   * `package` used to be `electron-builder --dir` and nothing else.
   *
   * electron-builder copies `../backend/dist-bundle` and `../frontend/dist` verbatim, and neither packaging
   * script built either one — so the installer shipped whatever happened to be lying in the tree. Measured
   * once against a six-day-old bundle: the app started, and the code inside it was a week behind the repo it
   * was built from, with nothing anywhere saying so. A person cannot see this in the installer, and the first
   * symptom is a bug that was fixed days ago.
   *
   * The rule this pins is the one that cannot rot: anything the installer copies that a clean checkout does
   * not contain has to be named in the build that runs first. Adding a new bundled directory to
   * `extraResources` without building it fails here rather than in someone's install.
   */
  it("builds every shipped directory that is not in the repository", () => {
    const release = manifest.scripts["build:release"] ?? "";
    const ignored = ignoredOutputDirectories();

    const built = shippedSources().filter((source) => ignored.has(path.basename(source)));
    assert.ok(built.length >= 3, `expected the bundled outputs to still be shipped, saw ${built.join(", ")}`);

    for (const source of built) {
      // The desktop's own dist is built by this package's `build`, which build:release ends with; the others
      // are built through their own workspace, named by the directory they live in.
      const owner = source === "dist" ? "npm run build" : path.dirname(source);
      assert.ok(
        release.includes(owner),
        `${source} is copied into the installer but ${owner} is not built by build:release: ${release}`,
      );
    }
  });

  it("runs that build before electron-builder, on both packaging entry points", () => {
    for (const name of ["package", "package:installer"]) {
      const script = manifest.scripts[name] ?? "";
      assert.ok(script.includes("build:release"), `${name} does not build first: ${script}`);
      assert.ok(
        script.indexOf("build:release") < script.indexOf("electron-builder"),
        `${name} builds after packaging, which is the same as not building: ${script}`,
      );
    }
  });
});
