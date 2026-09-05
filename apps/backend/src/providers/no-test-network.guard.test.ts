import { afterEach, describe, expect, it, vi } from "vitest";

import { assertRealNetworkCallAllowed } from "./no-test-network.guard.js";

const previousVitest = process.env.VITEST;
const previousNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  if (previousVitest === undefined) delete process.env.VITEST; else process.env.VITEST = previousVitest;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
});

/**
 * The one control in this repository whose failure costs real money and leaves no trace — and it had no test.
 *
 * docs/06_DECISIONS.md D-016: four real Runway tasks, about a dollar, appearing in no project.json and no
 * budget ledger, traced to a test process reaching the real API with the key that sits at apps/backend/.env.
 * This guard is what stands there now, and every paid adapter calls it before its first request.
 *
 * Nothing was checking that it still refuses. Its three ways of quietly becoming a no-op are all one line each:
 * the environment check returning early where it should not, the mock detection accepting a plain function, or
 * the order of the two being swapped.
 */
describe("refusing a real provider call from a test process", () => {
  it("throws on a plain fetch, and names the provider so the message says what nearly went out", () => {
    // The message is the whole diagnosis when this fires in someone else's test run.
    expect(() => assertRealNetworkCallAllowed("Runway", (async () => new Response()) as unknown as typeof fetch))
      .toThrow(/Runway/);
    expect(() => assertRealNetworkCallAllowed("OpenAI", fetch)).toThrow(/OpenAI/);
  });

  it("allows a mocked fetch, which is what every test is supposed to pass", () => {
    // vi.fn() carries `.mock`; the native fetch never does. That is the whole distinction the guard draws.
    expect(() => assertRealNetworkCallAllowed("Runway", vi.fn() as unknown as typeof fetch)).not.toThrow();
  });

  it("stands aside outside a test process, so production is never blocked by it", () => {
    // The escape hatch is deliberate and has to keep working: this guard refusing a real run would take the
    // whole app down rather than protect it.
    delete process.env.VITEST;
    process.env.NODE_ENV = "production";
    expect(() => assertRealNetworkCallAllowed("Runway", fetch)).not.toThrow();
  });

  it("still refuses when NODE_ENV says test even with VITEST unset", () => {
    // Both halves of the condition matter — a runner that does not set VITEST is exactly the case where the
    // charge would go out unnoticed.
    delete process.env.VITEST;
    process.env.NODE_ENV = "test";
    expect(() => assertRealNetworkCallAllowed("OpenAI", fetch)).toThrow(/OpenAI/);
  });
});
