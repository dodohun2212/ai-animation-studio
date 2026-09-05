import assert from "node:assert/strict";
import { test } from "node:test";
import { migrateUserDataFolder } from "./userdata-migration.ts";

function fakeDeps(existing: Set<string>) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      pathExists: async (target: string) => existing.has(target),
      rename: async (from: string, to: string) => { calls.push(`rename:${from}->${to}`); existing.delete(from); existing.add(to); },
      copyRecursive: async (from: string, to: string) => { calls.push(`copy:${from}->${to}`); existing.add(to); },
      mkdirForFile: async (target: string) => { calls.push(`mkdir:${target}`); },
      removeRecursive: async (target: string) => { calls.push(`remove:${target}`); existing.delete(target); },
    },
  };
}

test("does nothing when old and new paths are already the same", async () => {
  const { deps, calls } = fakeDeps(new Set(["/same"]));
  await migrateUserDataFolder("/same", "/same", deps);
  assert.deepEqual(calls, []);
});

test("does nothing when there is nothing at the old path — a fresh install", async () => {
  const { deps, calls } = fakeDeps(new Set());
  await migrateUserDataFolder("/old", "/new", deps);
  assert.deepEqual(calls, []);
});

test("does nothing, and never touches the old path, when the new path already has something — a previous migration already ran", async () => {
  const existing = new Set(["/old", "/new"]);
  const { deps, calls } = fakeDeps(existing);
  await migrateUserDataFolder("/old", "/new", deps);
  assert.deepEqual(calls, []);
  assert.ok(existing.has("/old")); // untouched, not deleted just because a migration was considered
});

test("renames old to new when new does not exist yet", async () => {
  const existing = new Set(["/old"]);
  const { deps, calls } = fakeDeps(existing);
  await migrateUserDataFolder("/old", "/new", deps);
  assert.deepEqual(calls, ["rename:/old->/new"]);
  assert.ok(!existing.has("/old"));
  assert.ok(existing.has("/new"));
});

test("falls back to copying (never deleting the old path) when rename fails, e.g. across drives", async () => {
  const existing = new Set(["/old"]);
  const { deps, calls } = fakeDeps(existing);
  const failingFirstRename = {
    ...deps,
    rename: async (from: string, to: string) => {
      if (from === "/old") throw new Error("EXDEV");
      calls.push(`rename:${from}->${to}`); existing.delete(from); existing.add(to);
    },
  };

  await migrateUserDataFolder("/old", "/new", failingFirstRename);

  // Copied into staging and renamed into place, never written at /new directly.
  assert.deepEqual(calls, ["mkdir:/new", "remove:/new.migrating", "copy:/old->/new.migrating", "rename:/new.migrating->/new"]);
  assert.equal(existing.has("/old"), true, "the old path is never deleted, even after a successful copy");
  assert.equal(existing.has("/new"), true);
});

/**
 * The failure that looked like data loss without ever losing a byte.
 *
 * Copying straight into /new left it half-populated, and the "already migrated" check above then read that on
 * the next launch as a finished migration — so the app opened on partial data while the whole of it sat at the
 * old path. Staging means /new either does not exist or is complete, and a failed attempt just runs again.
 */
test("leaves nothing at the new path when the copy fails partway, so the next launch retries", async () => {
  const existing = new Set(["/old"]);
  const { deps, calls } = fakeDeps(existing);
  const failingCopy = {
    ...deps,
    rename: async (from: string, to: string) => {
      if (from === "/old") throw new Error("EXDEV");
      calls.push(`rename:${from}->${to}`); existing.delete(from); existing.add(to);
    },
    copyRecursive: async (from: string, to: string) => {
      calls.push(`copy:${from}->${to}`);
      existing.add(to);
      throw new Error("ENOSPC halfway through");
    },
  };

  await assert.rejects(migrateUserDataFolder("/old", "/new", failingCopy));

  assert.equal(existing.has("/new"), false, "a half-written new path must not survive to be mistaken for a finished migration");
  assert.equal(existing.has("/new.migrating"), false, "the staging folder is cleaned up too");
  assert.equal(existing.has("/old"), true, "the data is still where it was");
});
