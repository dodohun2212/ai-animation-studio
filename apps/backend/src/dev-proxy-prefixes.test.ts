import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { API_ROUTES } from "@ai-animation-studio/shared";

/**
 * Repo-wide guard: every top-level route prefix the contract has must be proxied by the Vite dev server.
 *
 * In browser dev the frontend is served by Vite and the API by Nest on another port, so an unproxied path is
 * not a connection error — **Vite answers it with index.html**. The fetch succeeds, returns 200, and fails
 * while being parsed as JSON. What a person sees is an empty screen or a card that vanished, never "the
 * backend was not reached", and the packaged app is unaffected because there both halves share one origin.
 *
 * `apps/frontend/vite.config.ts` already says the list is exhaustive against API_ROUTES. It says so in prose,
 * which is how it stopped being true: `/audio` and `/videos` were both absent, so the audio library and video
 * library screens were dead in the browser while working in the packaged app. The comment describing the rule
 * was correct the whole time — nothing was comparing it to the table it describes.
 *
 * Both directions, because both are a mistake. A missing prefix breaks a screen in dev; an extra one claims a
 * prefix the contract does not have, which is the map-entry-for-a-code-nobody-throws shape one file over in
 * error-code-reach.test.ts — it tells the next reader that path is alive.
 *
 * Lives here for the reason decision-doc-references.test.ts gives: its scope is the repo, and this workspace's
 * suite is the one that runs in every verification pass.
 *
 * 🟠 One limit, measured rather than assumed: this reads API_ROUTES from the built shared package, so a prefix
 * added to `packages/shared/src` and not yet compiled is invisible here and the guard passes. `npm run
 * typecheck` and `npm test` both build shared first, so every verification pass sees the current table — but a
 * bare `vitest run` of this file alone can report green about a stale one. Injecting a new prefix without a
 * rebuild passes; with one, it fails.
 */

const CURRENT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const VITE_CONFIG = path.resolve(CURRENT_DIRECTORY, "../../..", "apps", "frontend", "vite.config.ts");

/**
 * The first segment of every path the contract can produce.
 *
 * Taken from the values at runtime rather than by reading the source: an entry is either a literal path or a
 * function that builds one, and calling each function with a placeholder is what makes the two kinds
 * comparable. A source scan would have to re-implement that, and a route helper that takes an argument is
 * exactly the shape a hand-written scan of this table missed on 2026-09-08.
 */
function contractPrefixes(): Set<string> {
  const prefixes = new Set<string>();
  for (const route of Object.values(API_ROUTES)) {
    const value = typeof route === "function"
      // Every helper builds its path from its arguments by interpolation, so any placeholder yields the same
      // first segment. `1` covers the numeric ones (episode numbers) without a second call shape.
      ? (route as (...args: unknown[]) => string)("x", "x", "x", 1, 1)
      : route;
    if (typeof value !== "string" || !value.startsWith("/")) continue;
    prefixes.add(`/${value.slice(1).split("/")[0]!}`);
  }
  return prefixes;
}

/** The keys of the `proxy` table — `"/audio": "http://…"`. */
async function proxiedPrefixes(): Promise<Set<string>> {
  const config = await fs.readFile(VITE_CONFIG, "utf8");
  return new Set([...config.matchAll(/^\s*"(\/[^"]+)":\s*"http/gm)].map((match) => match[1]!));
}

describe("the dev server proxies every prefix the contract can produce", () => {
  it("finds both lists it is supposed to be comparing", async () => {
    const contract = contractPrefixes();
    const proxied = await proxiedPrefixes();

    expect(contract.size).toBeGreaterThan(5);
    expect(proxied.size).toBeGreaterThan(5);
    // The two the comment names as having been missing, so a collector that stopped finding prefixes fails
    // here rather than passing the comparison by finding nothing on either side.
    expect(contract.has("/audio")).toBe(true);
    expect(contract.has("/videos")).toBe(true);
  });

  it("has no contract prefix the dev server would answer with index.html", async () => {
    const proxied = await proxiedPrefixes();
    const unproxied = [...contractPrefixes()].filter((prefix) => !proxied.has(prefix)).sort();
    expect(unproxied).toEqual([]);
  });

  it("proxies no prefix the contract cannot produce", async () => {
    const contract = contractPrefixes();
    const stray = [...await proxiedPrefixes()].filter((prefix) => !contract.has(prefix)).sort();
    expect(stray).toEqual([]);
  });
});
