import assert from "node:assert/strict";
import { test } from "node:test";
import { startProductionWindow } from "./production-startup.ts";

/** Records the order things happened in, which is the whole question here. */
function fakeShell(ready: boolean) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      waitUntilReady: async () => ready,
      showStartupFailure: async () => { calls.push("dialog"); },
      quit: () => { calls.push("quit"); },
      createWindow: () => { calls.push("window"); return { id: 1 }; },
      load: async (_window: { id: number }, url: string) => { calls.push(`load ${url}`); },
      port: 4317,
    },
  };
}

/**
 * `app.quit()` asks the app to close and returns immediately, so the lines after it used to keep running: the
 * shell told the person the server had failed to start and then opened a window onto that server, putting
 * Chromium's own "can't reach this page" behind the dialog they had just read. A window created during a quit
 * can also cancel the quit, leaving the app running against a backend that is not there.
 */
test("does not open a window when the backend never became ready", async () => {
  const { calls, deps } = fakeShell(false);

  assert.equal(await startProductionWindow(deps), undefined);

  assert.deepEqual(calls, ["dialog", "quit"]);
});

/** The counterpart: a shell that never opens a window at all would pass the test above. */
test("opens the window on the backend's own port once it is ready", async () => {
  const { calls, deps } = fakeShell(true);

  assert.deepEqual(await startProductionWindow(deps), { id: 1 });

  assert.deepEqual(calls, ["window", "load http://127.0.0.1:4317/"]);
});
