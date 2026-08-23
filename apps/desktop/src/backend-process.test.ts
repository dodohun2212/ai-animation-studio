import assert from "node:assert/strict";
import { test } from "node:test";
import { BackendProcessManager, type ChildLike } from "./backend-process.ts";

class FakeChild implements ChildLike {
  private exitListener: ((code: number | null) => void) | undefined;
  killed = false;

  once(event: "exit", listener: (code: number | null) => void): void {
    if (event === "exit") this.exitListener = listener;
  }

  kill(): void {
    this.killed = true;
  }

  crash(): void {
    this.exitListener?.(1);
  }
}

test("waitUntilReady resolves true as soon as the health check succeeds", async () => {
  let calls = 0;
  const manager = new BackendProcessManager({
    fork: () => new FakeChild(),
    checkHealth: async () => {
      calls += 1;
      return calls >= 3;
    },
    wait: async () => undefined,
    modulePath: "unused",
    env: {},
    port: 4317,
  });
  manager.start();
  assert.equal(await manager.waitUntilReady(1000, 1), true);
  assert.equal(calls, 3);
});

test("waitUntilReady resolves false once the timeout elapses without success", async () => {
  let now = 0;
  const manager = new BackendProcessManager({
    fork: () => new FakeChild(),
    checkHealth: async () => false,
    wait: async (ms) => { now += ms; },
    modulePath: "unused",
    env: {},
    port: 4317,
  });
  manager.start();
  const originalNow = Date.now;
  Date.now = () => originalNow() + now;
  try {
    assert.equal(await manager.waitUntilReady(50, 10), false);
  } finally {
    Date.now = originalNow;
  }
});

test("respawns after an unexpected exit up to the bounded restart limit, then stops", () => {
  const spawned: FakeChild[] = [];
  const manager = new BackendProcessManager({
    fork: () => {
      const child = new FakeChild();
      spawned.push(child);
      return child;
    },
    checkHealth: async () => true,
    wait: async () => undefined,
    modulePath: "unused",
    env: {},
    port: 4317,
    maxAutoRestarts: 2,
  });
  manager.start();
  assert.equal(spawned.length, 1);

  spawned[0]?.crash();
  assert.equal(spawned.length, 2);
  assert.equal(manager.restartCount, 1);

  spawned[1]?.crash();
  assert.equal(spawned.length, 3);
  assert.equal(manager.restartCount, 2);

  spawned[2]?.crash();
  assert.equal(spawned.length, 3, "must not restart beyond maxAutoRestarts");
});

test("stop() prevents any further auto-restart and kills the current child", () => {
  const spawned: FakeChild[] = [];
  const manager = new BackendProcessManager({
    fork: () => {
      const child = new FakeChild();
      spawned.push(child);
      return child;
    },
    checkHealth: async () => true,
    wait: async () => undefined,
    modulePath: "unused",
    env: {},
    port: 4317,
  });
  manager.start();
  manager.stop();
  assert.equal(spawned[0]?.killed, true);
  spawned[0]?.crash();
  assert.equal(spawned.length, 1, "must not restart after an intentional stop");
});
