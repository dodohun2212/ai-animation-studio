import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "./assets.repository.js";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function runWriter(root: string, variant: string): Promise<void> {
  const vitest = path.resolve(process.cwd(), "../../node_modules/vitest/vitest.mjs");
  await run(process.execPath, [vitest, "run", "src/assets/assets.cross-process.worker.test.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, ASSET_CROSS_PROCESS_ROOT: root, ASSET_CROSS_PROCESS_VARIANT: variant },
    timeout: 20_000,
  });
}

async function expectClean(root: string): Promise<void> {
  const directory = path.join(root, "asset_library");
  const entries = await fs.readdir(directory);
  expect(entries.filter((name) => name === ".assets-json.lock" || name.endsWith(".tmp"))).toEqual([]);
}

describe("cross-process Asset transactions", () => {
  it("preserves distinct writes and deduplicates same SHA across separate Node processes", async () => {
    const distinctRoot = await fs.mkdtemp(path.join(os.tmpdir(), "asset-process-distinct-")); roots.push(distinctRoot);
    await Promise.all([runWriter(distinctRoot, "first"), runWriter(distinctRoot, "second")]);
    expect(await new LocalAssetsRepository(distinctRoot).list()).toHaveLength(2);
    await expectClean(distinctRoot);

    const sameRoot = await fs.mkdtemp(path.join(os.tmpdir(), "asset-process-same-")); roots.push(sameRoot);
    await Promise.all([runWriter(sameRoot, "same"), runWriter(sameRoot, "same")]);
    expect(await new LocalAssetsRepository(sameRoot).list()).toHaveLength(1);
    await expectClean(sameRoot);
  }, 30_000);
});
