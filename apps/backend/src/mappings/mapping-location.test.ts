import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LocalProjectAssetMappingsRepository } from "./mappings.repository.js";

/**
 * Everything about MappingLocation rests on one claim: a directory only ever reaches the storage layer after the
 * module that owns that layout has validated it. These pin the claim rather than restating it in a comment.
 */
describe("projectLocation", () => {
  it("resolves a short project's own directory and names the id stored inside its files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mapping-location-"));
    try {
      const location = new LocalProjectAssetMappingsRepository(root).projectLocation("proj-1");
      expect(location.id).toBe("proj-1");
      expect(location.directory).toBe(path.join(path.resolve(root), "proj-1"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an id that would climb out of the root, before any directory exists to point at", () => {
    // Validation is on this side of the boundary precisely so a caller cannot hand in a path nobody checked.
    const repository = new LocalProjectAssetMappingsRepository(path.resolve("/data/projects"));
    for (const id of ["..", "../elsewhere", "a/b", ""]) {
      expect(() => repository.projectLocation(id)).toThrow();
    }
  });

  it("does not touch the disk until something asks whether the scope exists", async () => {
    // Building a location is cheap and total; only ensureExists() can fail on a project that is not there. That
    // split is what lets an owner that was loaded to be built skip the second read.
    const repository = new LocalProjectAssetMappingsRepository(path.resolve("/data/projects"));
    const location = repository.projectLocation("never-created");
    expect(location.directory).toContain("never-created");
    await expect(location.ensureExists()).rejects.toMatchObject({});
  });
});

describe("who is allowed to build a location", () => {
  it("is only the modules that own a storage layout", async () => {
    // The safety argument is "both constructors validate". That is only true while there are only the expected
    // ones, and a third would be a plain object literal somewhere — invisible in review, and exactly how an
    // unvalidated directory would get in. Keep this list short and deliberate.
    // Resolved from this file, not the working directory: vitest runs with the workspace as cwd and the repo
    // root elsewhere, and a path that only works under one of them is a guard that quietly stops guarding.
    const backendSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const allowed = new Set(["mappings/mappings.repository.ts"]);

    const offenders: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) { await walk(full); continue; }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        const relative = path.relative(backendSource, full).replaceAll(path.sep, "/");
        if (allowed.has(relative)) continue;
        if (/\bensureExists\s*:/.test(await fs.readFile(full, "utf8"))) offenders.push(relative);
      }
    };
    await walk(backendSource);

    expect(offenders).toEqual([]);
  });
});
