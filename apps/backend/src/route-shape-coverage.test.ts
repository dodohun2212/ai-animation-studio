import * as fs from "node:fs";
import * as path from "node:path";

import { API_ROUTES } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

/**
 * Every URL the client can build is a URL some controller answers.
 *
 * `API_ROUTES` is the only place both sides name a path, but they name it differently: the client calls a
 * builder that returns a finished URL, the server spells a pattern with `:param` segments. Nothing compares
 * the two, so a controller path can be edited — a segment renamed, a prefix moved — and every type still
 * checks while the screen that calls it starts getting 404s at runtime. This compares them.
 *
 * It is deliberately about *shape* only. It cannot see whether a handler reads the right parameter (the Story
 * Bible search read `?query=` as a path parameter, at a path that matched perfectly — see
 * story-bible-http.integration.test.ts), and it cannot see whether a screen ever calls the builder (see the
 * frontend's contract-request-coverage.test.ts). Three different holes, three different guards.
 */

const DUMMY = "ZZDUMMY";

/** A path with every variable segment replaced by `:x`, so a builder's output and a decorator's pattern meet. */
function normalize(url: string): string {
  const withoutQuery = url.split("?")[0] ?? "";
  return withoutQuery
    .split("/")
    .map((segment) => (segment.startsWith(DUMMY) ? ":x" : segment))
    .join("/")
    .replace(/:[A-Za-z0-9_]+/g, ":x")
    .replace(/\/+$/, "") || "/";
}

/** Resolves the `${API_ROUTES.x}` pieces a controller interpolates into its decorator; those are always strings. */
function resolveConstants(pattern: string): string {
  return pattern.replace(/\$\{API_ROUTES\.(\w+)\}/g, (_match, key: string) => {
    const value = (API_ROUTES as Record<string, unknown>)[key];
    return typeof value === "string" ? value : " UNRESOLVED";
  });
}

function clientShapes(): Map<string, string> {
  const shapes = new Map<string, string>();
  for (const [name, value] of Object.entries(API_ROUTES as Record<string, unknown>)) {
    if (typeof value === "string") { shapes.set(name, normalize(value)); continue; }
    if (typeof value !== "function") continue;
    // `length` is the declared parameter count — the builders have no optional or rest parameters, and a wrong
    // count here would interpolate `undefined` into the URL rather than throw, which is exactly the silent
    // miscount the size assertions below exist to catch.
    const args = Array.from({ length: value.length }, (_unused, index) => `${DUMMY}${index}`);
    shapes.set(name, normalize((value as (...args: unknown[]) => string)(...args)));
  }
  return shapes;
}

function controllerFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...controllerFiles(full));
    else if (entry.name.endsWith(".controller.ts")) found.push(full);
  }
  return found;
}

function serverShapes(): Set<string> {
  const shapes = new Set<string>();
  for (const file of controllerFiles(import.meta.dirname)) {
    const source = fs.readFileSync(file, "utf8");
    const prefixMatch = /@Controller\(\s*(?:`([^`]*)`|"([^"]*)")?\s*\)/.exec(source);
    let prefix = resolveConstants(prefixMatch?.[1] ?? prefixMatch?.[2] ?? "");
    if (prefix && !prefix.startsWith("/")) prefix = `/${prefix}`;
    // Four spellings, all in use: a template literal, a plain string, the constant handed over bare
    // (`@Get(API_ROUTES.audioLibrary)`), and a builder called with its parameter names
    // (`@Get(API_ROUTES.subtitleFont(":name"))`). Reading only the first two made fifteen served routes look
    // unserved; missing the fourth would push a single-segment parameterised route to invent a base constant
    // that is not itself a route — and every entry in API_ROUTES has to be one, which is the rule below.
    for (const match of source.matchAll(/@(?:Get|Post|Patch|Delete|Put)\(\s*(?:`([^`]*)`|"([^"]*)"|API_ROUTES\.(\w+)(?:\(([^)]*)\))?)?\s*\)/g)) {
      const named = match[3] === undefined ? undefined : (API_ROUTES as Record<string, unknown>)[match[3]];
      // A builder is called with the same parameter names the decorator declares, so its own output is the
      // pattern — `:name` goes in and comes back out inside the path it belongs to.
      const built = typeof named === "function" && match[4] !== undefined
        ? String((named as (...args: string[]) => string)(...match[4].split(",").map((argument) => argument.trim().replace(/^["'`]|["'`]$/g, ""))))
        : undefined;
      let route = resolveConstants(match[1] ?? match[2] ?? built ?? (typeof named === "string" ? named : ""));
      if (route && !route.startsWith("/")) route = `/${route}`;
      shapes.add(normalize(prefix + route));
    }
  }
  return shapes;
}

/** One entry per handler: the route it answers and the `@Param("...")` names it reads out of that route. */
function handlerParams(): Array<{ file: string; route: string; params: string[] }> {
  const handlers: Array<{ file: string; route: string; params: string[] }> = [];
  for (const file of controllerFiles(import.meta.dirname)) {
    const source = fs.readFileSync(file, "utf8");
    const prefixMatch = /@Controller\(\s*(?:`([^`]*)`|"([^"]*)")?\s*\)/.exec(source);
    const prefix = resolveConstants(prefixMatch?.[1] ?? prefixMatch?.[2] ?? "");
    // The decorator, then the handler's parameter list up to the return-type colon. Bounded so a regex that
    // loses its footing stops at the next handler instead of swallowing the rest of the file.
    for (const match of source.matchAll(/@(?:Get|Post|Patch|Delete|Put)\(\s*(?:`([^`]*)`|"([^"]*)"|API_ROUTES\.(\w+)(?:\(([^)]*)\))?)?\s*\)([\s\S]{0,1500}?)\)\s*:/g)) {
      const named = match[3] === undefined ? undefined : (API_ROUTES as Record<string, unknown>)[match[3]];
      // Same four spellings serverShapes reads; match[4] is a builder's arguments and match[5] the handler.
      const built = typeof named === "function" && match[4] !== undefined
        ? String((named as (...args: string[]) => string)(...match[4].split(",").map((argument) => argument.trim().replace(/^["'`]|["'`]$/g, ""))))
        : undefined;
      const route = prefix + resolveConstants(match[1] ?? match[2] ?? built ?? (typeof named === "string" ? named : ""));
      const params = [...(match[5] ?? "").matchAll(/@Param\(\s*"([^"]+)"\s*\)/g)].map((found) => found[1] ?? "");
      handlers.push({ file: path.basename(file), route, params });
    }
  }
  return handlers;
}

describe("every handler reads its parameters from a place the route actually has", () => {
  const handlers = handlerParams();

  it("read the handlers at all", () => {
    expect(handlers.length).toBeGreaterThan(100);
    expect(handlers.some((handler) => handler.params.length > 0)).toBe(true);
  });

  /**
   * `@Param("x")` on a path with no `:x` segment binds to nothing and hands the handler `undefined`.
   *
   * That is not a type error — the parameter is usually typed `unknown` or `string`, and `undefined` passes
   * either without complaint — so the route typechecks, its service tests pass, and every call fails. Story
   * Bible search sat like that: `?query=` read as a path parameter, 400 to every request, green everywhere.
   *
   * Query-string values belong to `@Query`, which this cannot mistake for a path segment.
   */
  it("never names a path parameter the route does not declare", () => {
    const mismatched = handlers.flatMap(({ file, route, params }) =>
      params.filter((name) => !new RegExp(`:${name}(?![A-Za-z0-9_])`).test(route))
        .map((name) => `${file} ${route} reads @Param("${name}")`));

    expect(mismatched).toEqual([]);
  });
});

describe("every route the client can build is a route the server serves", () => {
  const client = clientShapes();
  const server = serverShapes();

  // Both parses this file depends on are regexes over source text, and a regex that quietly matches nothing
  // makes an empty comparison look like a clean one. These are the tripwire for that, not a claim about the
  // right number of routes.
  it("read both sides at all", () => {
    expect(client.size).toBeGreaterThan(100);
    expect(server.size).toBeGreaterThan(100);
    expect([...client.values()].every((shape) => shape.startsWith("/"))).toBe(true);
    expect([...server].some((shape) => shape.includes(":x"))).toBe(true);
    expect([...server].some((shape) => shape.includes(" "))).toBe(false);
  });

  it("leaves no client route without a handler", () => {
    const unserved = [...client].filter(([, shape]) => !server.has(shape));

    // Named, not counted: the failure has to say which builder points at nothing.
    expect(unserved.map(([name, shape]) => `${name} -> ${shape}`)).toEqual([]);
  });
});
