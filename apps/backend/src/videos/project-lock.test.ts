import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectLockTimeoutError, withProjectLock } from "./project-lock.js";

let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "project-lock-test-"));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe("withProjectLock", () => {
  it("serializes two concurrent holders for the same key — the second only runs after the first releases", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      void withProjectLock(directory, "job", async () => {
        order.push("first-start");
        resolve();
        await new Promise<void>((r) => { releaseFirst = r; });
        order.push("first-end");
      });
    });
    await firstStarted;
    const second = withProjectLock(directory, "job", async () => { order.push("second"); });
    // Give the second attempt a chance to (wrongly) run concurrently if the lock did not actually hold.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await second;
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("lets two different keys proceed concurrently", async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const a = withProjectLock(directory, "a", async () => {
      order.push("a-start");
      await new Promise<void>((r) => { releaseA = r; });
      order.push("a-end");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const b = withProjectLock(directory, "b", async () => { order.push("b"); });
    await b;
    expect(order).toEqual(["a-start", "b"]);
    releaseA();
    await a;
  });

  it("reclaims a stale lock left by a holder that never released it, instead of waiting out the full acquire timeout", async () => {
    const lockFile = path.join(directory, ".lock-stale_job");
    await fs.writeFile(lockFile, JSON.stringify({ pid: 999999, acquiredAt: new Date(0).toISOString() }));
    // Back-date the file itself (writeFile stamps "now", not the fake old timestamp inside it) so it reads as abandoned.
    const old = new Date(Date.now() - 5 * 60_000);
    await fs.utimes(lockFile, old, old);
    const result = await withProjectLock(directory, "stale_job", async () => "ran");
    expect(result).toBe("ran");
  });

  it("throws ProjectLockTimeoutError, never waiting forever, when a holder keeps the lock past the acquire timeout", async () => {
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      void withProjectLock(directory, "busy_job", async () => {
        resolve();
        await new Promise<void>((r) => { releaseFirst = r; });
      });
    });
    await firstStarted;
    // A real call site never overrides timeoutMs — only this test does, so it can
    // exercise the timeout path in milliseconds instead of the real 10s ACQUIRE_TIMEOUT_MS.
    await expect(withProjectLock(directory, "busy_job", async () => "should not run", { timeoutMs: 100 }))
      .rejects.toThrow(ProjectLockTimeoutError);
    releaseFirst();
  });

  it("keeps a live holder's lock from being reclaimed as stale, however long the guarded work runs", async () => {
    // The staleness rule exists to reclaim locks from dead processes. Guarded work that outlives STALE_LOCK_MS is
    // not a dead process, and treating it as one hands the lock to a second arrival while the first is still
    // inside its paid provider call — the duplicate charge the lock was added to prevent, back again and only for
    // the slow calls people press twice. Back-dating the file here is what a minute of real work would look like.
    const lockFile = path.join(directory, ".lock-slow_job");
    let releaseFirst!: () => void;
    let started!: () => void;
    const backDated = new Promise<void>((resolve) => { started = resolve; });
    void withProjectLock(directory, "slow_job", async () => {
      const old = new Date(Date.now() - 5 * 60_000);
      await fs.utimes(lockFile, old, old);
      started();
      await new Promise<void>((r) => { releaseFirst = r; });
    }, { heartbeatMs: 20 });
    await backDated;

    // Wait for a beat to have actually landed rather than for a length of time one usually fits in. A fixed
    // wait is the same mistake this file's other race test made: on a loaded machine it elapses before the
    // timer fires, the file still reads as abandoned, and the test fails for a reason that is not the subject.
    const deadline = Date.now() + 5_000;
    for (;;) {
      const stat = await fs.stat(lockFile);
      if (Date.now() - stat.mtimeMs < 60_000) break;
      if (Date.now() > deadline) throw new Error("the holder never refreshed its lock");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    let second: unknown;
    try { second = await withProjectLock(directory, "slow_job", async () => "stole it", { timeoutMs: 0 }); }
    catch (error) { second = error; }
    expect(second).toBeInstanceOf(ProjectLockTimeoutError);
    releaseFirst();
  });

  it("does not delete a lock that was already reclaimed by someone else", async () => {
    // Releasing by filename alone deletes whatever happens to be at that path, including a lock a second holder
    // acquired after this one was reclaimed — freeing work that is still running. The token says whose it is.
    const lockFile = path.join(directory, ".lock-taken_job");
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      void withProjectLock(directory, "taken_job", async () => {
        resolve();
        await new Promise<void>((r) => { releaseFirst = r; });
      });
    });
    await firstStarted;

    await fs.writeFile(lockFile, JSON.stringify({ pid: 999999, token: "someone-else", acquiredAt: new Date().toISOString() }));
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const survivor: unknown = JSON.parse(await fs.readFile(lockFile, "utf8"));
    expect(survivor).toMatchObject({ token: "someone-else" });
  });

  it("releases the lock file even when the wrapped function throws", async () => {
    await expect(withProjectLock(directory, "job", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // A fresh acquire must succeed immediately — nothing left behind by the failed attempt.
    const result = await withProjectLock(directory, "job", async () => "ok");
    expect(result).toBe("ok");
  });
});
