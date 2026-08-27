import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramLoginService } from "./instagram-login.service.js";
import { DESKTOP_REDIRECT_URI } from "./instagram-oauth.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

/** Answers the two token exchanges in order: code -> short-lived, then short-lived -> long-lived. */
function exchangeFetch(longLivedSeconds: number | null = 5_184_000) {
  return vi.fn()
    .mockResolvedValueOnce(jsonResponse(200, { access_token: "short-token", expires_in: 3600 }))
    .mockResolvedValueOnce(jsonResponse(200, {
      access_token: "long-token",
      ...(longLivedSeconds === null ? {} : { expires_in: longLivedSeconds }),
    }));
}

async function setup(options: { app?: boolean; fetchImpl?: ReturnType<typeof vi.fn>; now?: () => number } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instagram-login-")); roots.push(root);
  const connection = new InstagramConnectionStore(root);
  if (options.app !== false) await connection.saveAppCredentials({ appId: "app-1", appSecret: "secret-1" });
  const service = new InstagramLoginService(
    connection,
    { fetchImpl: options.fetchImpl ?? vi.fn(), sleep: async () => {} },
    options.now ?? Date.now,
  );
  return { root, connection, service };
}

/** Drives a full successful sign-in and returns the state the service issued. */
async function signIn(service: InstagramLoginService) {
  const started = await service.start();
  const state = new URL(started.url).searchParams.get("state")!;
  return { state, result: await service.complete({ redirectedUrl: `${DESKTOP_REDIRECT_URI}?code=the-code&state=${state}` }) };
}

describe("InstagramLoginService.status", () => {
  it("reports nothing configured on a fresh install", async () => {
    const { service } = await setup({ app: false });
    await expect(service.status()).resolves.toEqual({ appConfigured: false, tokenStored: false });
  });

  it("separates having the app registered from being signed in", async () => {
    const { service } = await setup();
    await expect(service.status()).resolves.toEqual({ appConfigured: true, tokenStored: false });
  });
});

describe("InstagramLoginService.saveApp", () => {
  it("stores the app credentials and reports them configured", async () => {
    const { service } = await setup({ app: false });
    await expect(service.saveApp({ appId: "app-9", appSecret: "secret-9" }))
      .resolves.toEqual({ appConfigured: true, tokenStored: false });
  });

  it("rejects a malformed request body", async () => {
    const { service } = await setup({ app: false });
    for (const body of [undefined, {}, { appId: "a" }, { appId: "", appSecret: "s" }, { appId: "a", appSecret: "s", extra: 1 }]) {
      await expect(service.saveApp(body)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
  });

  it("drops a stored token when the app itself changes", async () => {
    // A token issued to one Meta app means nothing to another; keeping it would leave the app reporting itself
    // signed in while every publish failed.
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    await signIn(service);
    expect((await service.status()).tokenStored).toBe(true);

    await service.saveApp({ appId: "different-app", appSecret: "different-secret" });
    await expect(service.status()).resolves.toEqual({ appConfigured: true, tokenStored: false });
  });

  it("keeps the token when the same app credentials are saved again", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    await signIn(service);
    await service.saveApp({ appId: "app-1", appSecret: "secret-1" });
    expect((await service.status()).tokenStored).toBe(true);
  });
});

describe("InstagramLoginService.start", () => {
  it("refuses to start before the app id and secret are entered", async () => {
    const { service } = await setup({ app: false });
    await expect(service.start()).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("returns the login URL and the prefix that marks arrival", async () => {
    const { service } = await setup();
    const started = await service.start();
    expect(started.redirectPrefix).toBe(DESKTOP_REDIRECT_URI);
    const url = new URL(started.url);
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("issues a different state every time", async () => {
    const { service } = await setup();
    const first = new URL((await service.start()).url).searchParams.get("state");
    const second = new URL((await service.start()).url).searchParams.get("state");
    expect(first).not.toBe(second);
  });
});

describe("InstagramLoginService.complete", () => {
  it("exchanges the code for a long-lived token and records an absolute expiry", async () => {
    const now = Date.parse("2026-08-27T00:00:00.000Z");
    const { service, connection } = await setup({ fetchImpl: exchangeFetch(5_184_000), now: () => now });
    const { result } = await signIn(service);

    expect(result).toEqual({
      appConfigured: true,
      tokenStored: true,
      tokenExpiresAt: new Date(now + 5_184_000 * 1000).toISOString(),
    });
    await expect(connection.token()).resolves.toMatchObject({ accessToken: "long-token" });
  });

  it("records no expiry, rather than inventing one, when Meta states none", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch(null) });
    const { result } = await signIn(service);
    expect(result.tokenStored).toBe(true);
    expect(result.tokenExpiresAt).toBeUndefined();
  });

  it("refuses a code whose state does not match the one it issued", async () => {
    const fetchImpl = exchangeFetch();
    const { service } = await setup({ fetchImpl });
    await service.start();
    await expect(service.complete({ redirectedUrl: `${DESKTOP_REDIRECT_URI}?code=c&state=not-the-issued-state` }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect(fetchImpl).not.toHaveBeenCalled(); // never exchanged
  });

  it("spends an issued state exactly once", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    const started = await service.start();
    const state = new URL(started.url).searchParams.get("state")!;
    const url = `${DESKTOP_REDIRECT_URI}?code=the-code&state=${state}`;
    await service.complete({ redirectedUrl: url });
    await expect(service.complete({ redirectedUrl: url })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("refuses a state that has gone stale", async () => {
    let now = Date.parse("2026-08-27T00:00:00.000Z");
    const { service } = await setup({ fetchImpl: exchangeFetch(), now: () => now });
    const started = await service.start();
    const state = new URL(started.url).searchParams.get("state")!;
    now += 11 * 60 * 1000;
    await expect(service.complete({ redirectedUrl: `${DESKTOP_REDIRECT_URI}?code=c&state=${state}` }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("refuses a completion that was never started", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    await expect(service.complete({ redirectedUrl: `${DESKTOP_REDIRECT_URI}?code=c&state=whatever` }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("reports a refused sign-in rather than treating it as an exchange failure", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    const started = await service.start();
    const state = new URL(started.url).searchParams.get("state")!;
    await expect(service.complete({ redirectedUrl: `${DESKTOP_REDIRECT_URI}?error=access_denied&state=${state}` }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("surfaces a rejected exchange as a provider error, leaving no token behind", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "bad code", code: 100 } }));
    const { service } = await setup({ fetchImpl });
    const started = await service.start();
    const state = new URL(started.url).searchParams.get("state")!;
    await expect(service.complete({ redirectedUrl: `${DESKTOP_REDIRECT_URI}?code=c&state=${state}` }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_PROVIDER_ERROR" } });
    expect((await service.status()).tokenStored).toBe(false);
  });

  it("rejects a malformed request body", async () => {
    const { service } = await setup();
    for (const body of [undefined, {}, { redirectedUrl: "" }, { redirectedUrl: "x", extra: 1 }]) {
      await expect(service.complete(body)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
  });
});

describe("InstagramLoginService.signOut", () => {
  it("forgets the token but keeps the app registration", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    await signIn(service);
    await expect(service.signOut()).resolves.toEqual({ appConfigured: true, tokenStored: false });
  });

  it("reports not-connected when there is nothing registered to sign out of", async () => {
    const { service } = await setup({ app: false });
    await expect(service.signOut()).rejects.toMatchObject({ response: { code: "INSTAGRAM_NOT_CONNECTED" } });
  });
});
