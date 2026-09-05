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

// Resolved from this file, not process.cwd(). The worker is spawned with a path built from that base, so
// running the suite from the repo root instead of apps/backend pointed both at the wrong directory and the test
// failed on a missing vitest rather than on anything it was testing.
const BACKEND_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");

/**
 * Reports what the child actually did when it does not succeed.
 *
 * This test failed once inside a full backend run on 2026-09-06 and has not been reproduced since — 5 runs on
 * its own and 3 more full runs, all green. It had gone unnamed roughly four times before that, because what a
 * rejected `execFile` says is "Command failed": you cannot tell a child killed at the timeout from one whose
 * own assertions failed, and by the time anyone reads it the directory is gone.
 *
 * So the next occurrence has to arrive with its evidence. Deliberately not a retry and not a longer timeout:
 * on an idle machine one child takes about 0.8s against a 20s budget, so a timeout is a poor explanation and
 * padding it further would only hide whatever this really is. What this guards is two processes writing one
 * asset library — if that is unsafe under load, the flake is the finding, not the noise.
 */
async function runWriter(root: string, variant: string): Promise<void> {
  const vitest = path.resolve(BACKEND_ROOT, "../../node_modules/vitest/vitest.mjs");
  try {
    await run(process.execPath, [vitest, "run", "src/assets/assets.cross-process.worker.test.ts"], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, ASSET_CROSS_PROCESS_ROOT: root, ASSET_CROSS_PROCESS_VARIANT: variant },
      timeout: 20_000,
    });
  } catch (error) {
    const failure = error as { killed?: boolean; code?: number | string; signal?: string; stdout?: string; stderr?: string };
    throw new Error([
      `cross-process writer "${variant}" did not finish cleanly`,
      `killed by timeout: ${failure.killed === true} · exit: ${String(failure.code)} · signal: ${String(failure.signal)}`,
      `stdout tail: ${(failure.stdout ?? "").slice(-1500)}`,
      `stderr tail: ${(failure.stderr ?? "").slice(-1500)}`,
    ].join(String.fromCharCode(10)));
  }
}

/** What the library looks like right now, so a wrong count arrives with the files that produced it. */
async function snapshot(root: string): Promise<string> {
  const directory = path.join(root, "asset_library");
  let entries: string[];
  try { entries = await fs.readdir(directory); } catch (error) { return `asset_library unreadable: ${String(error)}`; }
  let json = "";
  try { json = (await fs.readFile(path.join(directory, "assets.json"), "utf8")).slice(0, 2000); } catch (error) { json = `assets.json unreadable: ${String(error)}`; }
  return `${directory} contains [${entries.join(", ")}] · assets.json: ${json}`;
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
    const distinct = await new LocalAssetsRepository(distinctRoot).list();
    expect(distinct, await snapshot(distinctRoot)).toHaveLength(2);
    await expectClean(distinctRoot);

    const sameRoot = await fs.mkdtemp(path.join(os.tmpdir(), "asset-process-same-")); roots.push(sameRoot);
    await Promise.all([runWriter(sameRoot, "same"), runWriter(sameRoot, "same")]);
    const same = await new LocalAssetsRepository(sameRoot).list();
    expect(same, await snapshot(sameRoot)).toHaveLength(1);
    await expectClean(sameRoot);
  }, 30_000);
});
