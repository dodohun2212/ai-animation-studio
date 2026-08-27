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
  const deps = {
    pathExists: async (target: string) => existing.has(target),
    rename: async () => { throw new Error("EXDEV: cross-device link not permitted"); },
    copyRecursive: async (from: string, to: string) => { existing.add(to); },
    mkdirForFile: async () => {},
  };
  await migrateUserDataFolder("/old", "/new", deps);
  assert.ok(existing.has("/old")); // still there — never deleted on the fallback path
  assert.ok(existing.has("/new"));
});
