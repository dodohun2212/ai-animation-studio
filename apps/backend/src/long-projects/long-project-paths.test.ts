import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { episodeDirectoryName, longStoryRoot, LONG_STORY_DIRECTORY } from "./long-project-paths.js";

const ROOT = path.resolve("/data/projects");

describe("longStoryRoot", () => {
  it("puts a Long Project's files under its own project directory", () => {
    expect(longStoryRoot(ROOT, "proj-1")).toBe(path.join(ROOT, "proj-1", LONG_STORY_DIRECTORY));
  });

  it("takes the root as an argument, so the archive is the same layout rather than a second function", () => {
    // A second function is a second thing to keep correct, and this one is only correct because it is alone.
    const archive = path.join(ROOT, ".archive");
    expect(longStoryRoot(archive, "proj-1")).toBe(path.join(archive, "proj-1", LONG_STORY_DIRECTORY));
  });

  it("refuses a project id that could climb out of the root", () => {
    for (const id of ["..", "../other", "a/b", "a\b", "", "   "]) {
      expect(() => longStoryRoot(ROOT, id)).toThrow();
    }
  });

  it("answers with the long-project exception, not the short project's", () => {
    // Both carry UNSAFE_PROJECT_ID and 400 — this is about which route's vocabulary a long-project path speaks,
    // and it is the difference that used to depend on which of thirteen copies you happened to call.
    try {
      longStoryRoot(ROOT, "..");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { getResponse(): { code: string } }).getResponse().code).toBe("UNSAFE_PROJECT_ID");
    }
  });
});

describe("episodeDirectoryName", () => {
  it("pads to two digits and keeps going past ninety-nine", () => {
    expect(episodeDirectoryName(1)).toBe("Episode01");
    expect(episodeDirectoryName(7)).toBe("Episode07");
    expect(episodeDirectoryName(12)).toBe("Episode12");
    expect(episodeDirectoryName(100)).toBe("Episode100");
  });

  it("refuses anything that is not a whole episode number", () => {
    // Validating here rather than in each caller is the point: a name is one path.join away from a path, so a
    // caller holding an unchecked name already holds the problem.
    for (const number of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => episodeDirectoryName(number)).toThrow();
    }
  });

  it("never yields anything that could leave the directory it is joined onto", () => {
    // This is the guarantee one caller used to re-check for itself with a path.relative() containment test after
    // joining. That check could not fire, and a check that cannot fire still tells the next reader the name is
    // untrusted. The property is real, so it is asserted where the name is made instead of where it is used.
    for (const number of [1, 9, 10, 99, 100, 1234]) {
      const name = episodeDirectoryName(number);
      expect(name).toMatch(/^Episode\d+$/);
      expect(name).not.toContain("/");
      expect(name).not.toContain("\\");
      expect(name).not.toContain("..");
    }
  });
});
