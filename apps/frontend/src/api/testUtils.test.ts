import { afterEach, describe, expect, it, vi } from "vitest";

import { sequence, stubFetchByRoute, withStatus } from "./testUtils.js";

/**
 * The route-keyed fetch stub, tested directly.
 *
 * It is test scaffolding, which is exactly why it needs its own tests: a screen test that fails because the
 * stub answered the wrong route looks identical to one that fails because the screen is wrong, and this helper
 * exists because three rounds were spent on that confusion.
 */

afterEach(() => vi.unstubAllGlobals());

/** The stub is typed as a bare vitest mock, so calling it needs the fetch shape spelled out here. */
type FetchStub = (input: string, init?: RequestInit) => Promise<Response>;
const call = (stub: ReturnType<typeof vi.fn>, url: string, init?: RequestInit) => (stub as unknown as FetchStub)(url, init);

describe("stubFetchByRoute", () => {
  it("answers by route, so the same route gives the same body whatever order it is asked in", async () => {
    const stub = stubFetchByRoute({ "GET /a/thing": { which: "thing" }, "GET /a/other": { which: "other" } });

    expect(await (await call(stub, "https://host/a/other")).json()).toEqual({ which: "other" });
    expect(await (await call(stub, "https://host/a/thing")).json()).toEqual({ which: "thing" });
    expect(await (await call(stub, "https://host/a/other")).json()).toEqual({ which: "other" });
  });

  it("gives the longest matching suffix when two keys both match the same URL", async () => {
    // Both of these are suffixes of the review URL, which is when the rule actually decides anything. My
    // first version of this test used `/generations/job` and `/generations/job/review` — only one of those
    // ever matches a given URL, so reversing the sort left it green and it measured nothing.
    const stub = stubFetchByRoute({ "GET /review": { which: "short" }, "GET /generations/job/review": { which: "long" } });

    expect(await (await call(stub, "https://host/x/generations/job/review")).json()).toEqual({ which: "long" });
    // And the short key still answers a URL only it matches.
    expect(await (await call(stub, "https://host/x/images/review")).json()).toEqual({ which: "short" });
  });

  it("separates methods, so a GET and a POST on one path are different answers", async () => {
    const stub = stubFetchByRoute({ "GET /thing": { read: true }, "POST /thing": { wrote: true } });

    expect(await (await call(stub, "https://host/thing", { method: "POST" })).json()).toEqual({ wrote: true });
    expect(await (await call(stub, "https://host/thing")).json()).toEqual({ read: true });
  });

  it("throws with the URL when nothing planned for a request, instead of answering with someone else's body", async () => {
    const stub = stubFetchByRoute({ "GET /planned": {} });

    await expect(call(stub, "https://host/unplanned")).rejects.toThrow("/unplanned");
  });

  it("walks a sequence for one route and then repeats its last answer", async () => {
    const stub = stubFetchByRoute({ "GET /poll": sequence([{ state: "running" }, { state: "succeeded" }]) });

    expect(await (await call(stub, "https://host/poll")).json()).toEqual({ state: "running" });
    expect(await (await call(stub, "https://host/poll")).json()).toEqual({ state: "succeeded" });
    expect(await (await call(stub, "https://host/poll")).json()).toEqual({ state: "succeeded" });
  });

  it("carries a status inside a sequence, so a refused submission can succeed on the retry", async () => {
    // The case that could not be written before: errorRoutes fixes a whole route as failing, and a plain
    // sequence is always 200. A paid submission being refused and then accepted is a real thing this app does.
    const stub = stubFetchByRoute({
      "POST /submit": sequence([withStatus(500, { code: "PROVIDER_ERROR", message: "x" }), { accepted: true }]),
    });

    const refused = await call(stub, "https://host/submit", { method: "POST" });
    expect(refused.status).toBe(500);
    expect(await refused.json()).toMatchObject({ code: "PROVIDER_ERROR" });

    const accepted = await call(stub, "https://host/submit", { method: "POST" });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ accepted: true });
  });

  it("takes a status on its own too, for a route that only ever fails", async () => {
    const stub = stubFetchByRoute({ "GET /gone": withStatus(404, { code: "NOT_FOUND", message: "x" }) });

    expect((await call(stub, "https://host/gone")).status).toBe(404);
  });

  it("still supports errorRoutes, which win over a body registered for the same route", async () => {
    const stub = stubFetchByRoute({ "GET /thing": { ok: true } }, { "GET /thing": { status: 503, body: { code: "DOWN", message: "x" } } });

    expect((await call(stub, "https://host/thing")).status).toBe(503);
  });
});
