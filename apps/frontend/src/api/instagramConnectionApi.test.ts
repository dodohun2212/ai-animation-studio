import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disconnectInstagram,
  getInstagramConnection,
  setInstagramApp,
  startInstagramLogin,
  toInstagramConnectionDisplayError,
} from "./instagramConnectionApi.js";
import { jsonResponse } from "./testUtils.js";

const CONNECTED = { appConfigured: true, tokenStored: true, tokenExpiresAt: "2026-10-26T00:00:00.000Z" };

describe("instagramConnectionApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Meta redirects back to the backend, which completes the login on its own — the screen only needs somewhere
  // to send the person, and never sees the code at all.
  it("asks for a login url and accepts one without a redirect prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { url: "https://www.facebook.com/v26.0/dialog/oauth?x=1" }));
    vi.stubGlobal("fetch", fetchMock);

    const started = await startInstagramLogin("callback");

    expect(started).toEqual({ url: "https://www.facebook.com/v26.0/dialog/oauth?x=1" });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe("/settings/instagram/login/start");
  });

  it("rejects a login start response with no url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));
    await expect(startInstagramLogin("callback")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("signs out via DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false, callbackLoginAvailable: true }));
    vi.stubGlobal("fetch", fetchMock);

    const status = await disconnectInstagram();

    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe("DELETE");
    expect(status.tokenStored).toBe(false);
  });

  it("maps a known code to a fixed message and never leaks the raw one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "INSTAGRAM_PROVIDER_ERROR", message: "raw backend detail" })));

    const caught = await startInstagramLogin("callback").catch((error: unknown) => error);
    const display = toInstagramConnectionDisplayError(caught);

    expect(display.code).toBe("INSTAGRAM_PROVIDER_ERROR");
    expect(display.message).not.toContain("raw backend detail");
  });

  it("reports a network failure as its own code rather than as a server answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const caught = await getInstagramConnection().catch((error: unknown) => error);
    expect(toInstagramConnectionDisplayError(caught).code).toBe("CLIENT_NETWORK_ERROR");
  });
});

describe("instagramConnectionApi source", () => {
  // The token and the secret must never reach this layer. A helper that "conveniently" returned one would be
  // the quietest possible way to put a secret on screen.
  it("never names a token or secret field it could render", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const srcRoot = path.dirname(url.fileURLToPath(import.meta.url));
    const content = await fsPromises.readFile(path.join(srcRoot, "instagramConnectionApi.ts"), "utf8");

    for (const pattern of [/accessToken/i, /access_token/i, /localStorage/, /sessionStorage/, /console\s*\./]) {
      expect(pattern.test(content)).toBe(false);
    }
  });
});
