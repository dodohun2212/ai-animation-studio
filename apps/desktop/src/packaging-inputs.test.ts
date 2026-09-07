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

  /**
   * The two static asset directories are found at runtime by looking beside the bundle, and that arrangement
   * is stated only in prose — in comments on `fontsRoot()` and `promptsRoot()` that say "shipped as a sibling
   * of the bundle (see apps/desktop/package.json's extraResources)". Nothing compares the comment to the
   * manifest, which is how `vite.config.ts`'s identical claim about API_ROUTES stopped being true.
   *
   * Both resolvers try three candidate depths and take the first that exists, so a `to:` that stops matching
   * does not throw — it silently returns the first candidate, a path that is not there. What follows is quiet
   * in both cases and expensive in both:
   *
   *   fonts    FFmpeg gets a fontsdir that does not exist and burns subtitles in whatever font the machine
   *            happens to have — the exact fallback measured and fixed on 2026-09-08, back again and only in
   *            the packaged build, where nobody is watching a dev console
   *   prompts  the story template is not found at the first paid call
   *
   * The marker each resolver actually tests for is asserted too, not just the directory: `promptsRoot()`
   * matches its packaged candidate only when `story/story_generation.txt` is inside it, so moving that one file
   * breaks the packaged app while every test that reads prompts from the repo keeps passing.
   */
  it("ships fonts and prompts where the backend looks for them — beside the bundle, with the marker each resolver tests", () => {
    const bundle = manifest.build.extraResources.find((resource) => resource.from.endsWith("/dist-bundle"));
    assert.ok(bundle, "the backend bundle is no longer in extraResources");

    for (const [name, marker] of [["fonts", "NotoSerifKR-Bold.ttf"], ["prompts", path.join("story", "story_generation.txt")]] as const) {
      const shipped = manifest.build.extraResources.find((resource) => path.basename(resource.from) === name);
      assert.ok(shipped, `${name} is no longer copied into the installer`);
      assert.equal(
        shipped.to,
        `${bundle.to}/${name}`,
        `${name} must land beside the bundle — ${name}Root()'s packaged candidate is path.resolve(moduleDirectory, "${name}")`,
      );
      assert.ok(
        fs.existsSync(path.join(repoRoot, name, marker)),
        `${name}/${marker} is what the resolver tests for; without it the packaged app falls back to a path that does not exist`,
      );
    }
  });
});
