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

  it("releases the lock file even when the wrapped function throws", async () => {
    await expect(withProjectLock(directory, "job", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // A fresh acquire must succeed immediately — nothing left behind by the failed attempt.
    const result = await withProjectLock(directory, "job", async () => "ok");
    expect(result).toBe("ok");
  });
});
