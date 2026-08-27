import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeInstagramLogin,
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

  it("reads the connection state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, CONNECTED));
    vi.stubGlobal("fetch", fetchMock);

    const status = await getInstagramConnection();

    expect(fetchMock).toHaveBeenCalledWith("/settings/instagram/connection", undefined);
    expect(status.tokenStored).toBe(true);
  });

  // A connection with no token yet is the normal first state, not a malformed answer.
  it("accepts a state with no token and no expiry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false })));

    const status = await getInstagramConnection();

    expect(status.tokenStored).toBe(false);
    expect(status.tokenExpiresAt).toBeUndefined();
  });

  it("rejects a state whose fields are the wrong type", async () => {
    for (const bad of [{ appConfigured: "yes", tokenStored: false }, { appConfigured: true, tokenStored: 1 }, { appConfigured: true, tokenStored: true, tokenExpiresAt: 5 }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, bad)));
      await expect(getInstagramConnection()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
    }
  });

  it("saves the app id and secret via PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false }));
    vi.stubGlobal("fetch", fetchMock);

    await setInstagramApp("  1234  ", "  secret  ");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/instagram/app");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ appId: "1234", appSecret: "secret" });
  });

  it("asks for a login url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      url: "https://www.facebook.com/v21.0/dialog/oauth?client_id=1234",
      redirectPrefix: "https://www.facebook.com/connect/login_success.html",
    })));

    const started = await startInstagramLogin();

    expect(started.redirectPrefix).toContain("login_success.html");
  });

  // The screen parses nothing out of the landed URL — the server reads the code and checks the state it issued,
  // so a redirect that did not come from our own request cannot be laundered into a login.
  it("hands the landed url back whole", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, CONNECTED));
    vi.stubGlobal("fetch", fetchMock);

    const landed = "https://www.facebook.com/connect/login_success.html?code=abc&state=xyz";
    await completeInstagramLogin(landed);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/instagram/login/complete");
    expect(JSON.parse(String(init.body))).toEqual({ redirectedUrl: landed });
  });

  it("signs out via DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false }));
    vi.stubGlobal("fetch", fetchMock);

    const status = await disconnectInstagram();

    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe("DELETE");
    expect(status.tokenStored).toBe(false);
  });

  it("maps a known code to a fixed message and never leaks the raw one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "INSTAGRAM_PROVIDER_ERROR", message: "raw backend detail" })));

    const caught = await startInstagramLogin().catch((error: unknown) => error);
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
