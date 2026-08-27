import { API_ROUTES } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

import viteConfig from "../vite.config.ts";

/**
 * Guards the browser dev server against a failure that does not look like one.
 *
 * Vite answers a path it was not told to proxy with index.html. So a call to a missing prefix does not fail —
 * it succeeds, returns a page of HTML, and dies while being parsed as JSON. What the person sees is an empty
 * screen or a card that quietly did not render, with nothing anywhere saying "the backend was never reached".
 * `/audio` and `/videos` were both missing this way: the audio and video library screens were dead in the
 * browser while working perfectly in the packaged app, which serves its own frontend and proxies nothing.
 *
 * This is a check rather than a rule because of the kind of mistake it is. Adding a route prefix and adding a
 * proxy entry happen in two different workspaces, and nothing about doing the first puts the second in front of
 * you — you have to remember, every time, forever. Forgetting is the normal outcome, so the list is derived
 * from the contract instead of trusted to a person.
 *
 * It reads the config object rather than the file's text on purpose: the text can say one thing while the
 * exported config says another, and it is the exported config that the dev server actually uses.
 */

function firstSegment(route: string): string {
  const [, segment = ""] = route.split("/");
  return `/${segment}`;
}

/**
 * Route builders are called with throwaway arguments purely to see the shape of path they produce — they only
 * interpolate what they are given, so the values do not matter. Calling them is what makes this exhaustive: a
 * prefix reachable only through a builder breaks in exactly the same way as a literal one.
 */
function contractPrefixes(): Set<string> {
  const prefixes = new Set<string>();
  for (const value of Object.values(API_ROUTES)) {
    const route = typeof value === "function"
      ? (value as (...args: unknown[]) => string)("id", 1, "b", "c")
      : value;
    if (typeof route === "string" && route.startsWith("/")) prefixes.add(firstSegment(route));
  }
  return prefixes;
}

function proxiedPrefixes(): Set<string> {
  const proxy = (viteConfig as { server?: { proxy?: Record<string, unknown> } }).server?.proxy;
  if (!proxy) throw new Error("vite.config.ts exports no server.proxy — the browser dev server reaches no backend");
  return new Set(Object.keys(proxy));
}

describe("browser dev proxy", () => {
  it("proxies every top-level prefix the shared contract can produce", () => {
    const proxied = proxiedPrefixes();
    expect([...contractPrefixes()].filter((prefix) => !proxied.has(prefix)).sort()).toEqual([]);
  });

  // A prefix the contract no longer has is dead configuration, and dead configuration reads as meaningful to
  // whoever finds it next.
  it("proxies nothing the contract does not have", () => {
    const contract = contractPrefixes();
    expect([...proxiedPrefixes()].filter((prefix) => !contract.has(prefix)).sort()).toEqual([]);
  });
});
