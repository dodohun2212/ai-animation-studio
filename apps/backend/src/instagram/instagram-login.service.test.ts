import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramLoginService } from "./instagram-login.service.js";
import { DESKTOP_REDIRECT_URI, instagramCallbackUrl } from "./instagram-oauth.js";

const REDIRECT = instagramCallbackUrl(4317);

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

async function setup(
  options: { app?: boolean; fetchImpl?: ReturnType<typeof vi.fn>; now?: () => number; callbackUri?: string | null } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instagram-login-")); roots.push(root);
  const connection = new InstagramConnectionStore(root);
  if (options.app !== false) await connection.saveAppCredentials({ appId: "app-1", appSecret: "secret-1" });
  const service = new InstagramLoginService(
    connection,
    options.callbackUri === undefined ? REDIRECT : options.callbackUri,
    { fetchImpl: options.fetchImpl ?? vi.fn(), sleep: async () => {} },
    options.now ?? Date.now,
  );
  return { root, connection, service };
}

/** Drives a full successful sign-in and returns the state the service issued. */
async function signIn(service: InstagramLoginService) {
  const started = await service.start({ flow: "desktop" });
  const state = new URL(started.url).searchParams.get("state")!;
  return { state, result: await service.complete({ code: "the-code", state }) };
}

describe("InstagramLoginService.status", () => {
  it("reports nothing configured on a fresh install", async () => {
    const { service } = await setup({ app: false });
    await expect(service.status()).resolves.toEqual({ appConfigured: false, tokenStored: false, callbackLoginAvailable: true });
  });

  it("separates having the app registered from being signed in", async () => {
    const { service } = await setup();
    await expect(service.status()).resolves.toEqual({ appConfigured: true, tokenStored: false, callbackLoginAvailable: true });
  });

  it("reports no browser login where this backend serves no callback", async () => {
    // The packaged app, and any development machine without a certificate. The screen needs this before the
    // button is pressed, because the alternative is a browser starting a login it has no way to finish.
    const { service } = await setup({ callbackUri: null });
    await expect(service.status()).resolves.toEqual({ appConfigured: true, tokenStored: false, callbackLoginAvailable: false });
  });

  it("answers about the callback from the same address it would hand to Meta", async () => {
    // Not a second reading of the environment: if these could be derived separately, the app could report a
    // browser login as available while the address behind it did not exist.
    const { service } = await setup();
    expect((await service.status()).callbackLoginAvailable).toBe(true);
    expect(new URL((await service.start({ flow: "callback" })).url).searchParams.get("redirect_uri")).toBe(REDIRECT);
  });
});

describe("InstagramLoginService.saveApp", () => {
  it("stores the app credentials and reports them configured", async () => {
    const { service } = await setup({ app: false });
    await expect(service.saveApp({ appId: "app-9", appSecret: "secret-9" }))
      .resolves.toEqual({ appConfigured: true, tokenStored: false, callbackLoginAvailable: true });
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
    await expect(service.status()).resolves.toEqual({ appConfigured: true, tokenStored: false, callbackLoginAvailable: true });
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
    await expect(service.start({ flow: "desktop" })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("sends the login to Meta's own success page, the only address this app can register (D-020)", async () => {
    const { service } = await setup();
    const started = await service.start({ flow: "desktop" });
    const url = new URL(started.url);
    expect(url.searchParams.get("redirect_uri")).toBe(DESKTOP_REDIRECT_URI);
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(started.redirectPrefix).toBe(DESKTOP_REDIRECT_URI);
  });

  it("refuses a start that names no flow, rather than picking one", async () => {
    // There is no default to fall back to on purpose. Both flows are real, and the wrong one fails silently —
    // the window lands where nobody is reading and the screen waits out its timeout with nothing to report.
    const { service } = await setup();
    await expect(service.start({})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.start(undefined)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.start({ flow: "browser" })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("refuses the callback flow where this backend serves no callback, instead of quietly using the other one", async () => {
    // Substituting the desktop flow here would hand a browser a login it has no way to finish: it cannot read
    // the URL Meta's page arrives at, so the sign-in would succeed at Meta and never land anywhere.
    const { service } = await setup({ callbackUri: null });
    await expect(service.start({ flow: "callback" })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect((await service.start({ flow: "desktop" })).redirectPrefix).toBe(DESKTOP_REDIRECT_URI);
  });

  it("uses this backend's callback, and names no window to watch, when that flow is asked for explicitly", async () => {
    const { service } = await setup();
    const started = await service.start({ flow: "callback" });
    expect(new URL(started.url).searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(started.redirectPrefix).toBeUndefined();
  });

  it("issues a different state every time", async () => {
    const { service } = await setup();
    const first = new URL((await service.start({ flow: "desktop" })).url).searchParams.get("state");
    const second = new URL((await service.start({ flow: "desktop" })).url).searchParams.get("state");
    expect(first).not.toBe(second);
  });
});

describe("InstagramLoginService.completeFromRedirect", () => {
  /** Drives a desktop sign-in the way the shell does: start, then hand back the URL the window landed on. */
  async function signInFromWindow(service: InstagramLoginService, extra = "") {
    const started = await service.start({ flow: "desktop" });
    const state = new URL(started.url).searchParams.get("state")!;
    return service.completeFromRedirect({ redirectedUrl: `${DESKTOP_REDIRECT_URI}?code=the-code&state=${state}${extra}` });
  }

  it("reads the code off the landed URL and stores the long-lived token", async () => {
    const { service, connection } = await setup({ fetchImpl: exchangeFetch() });
    await expect(signInFromWindow(service)).resolves.toMatchObject({ tokenStored: true });
    await expect(connection.token()).resolves.toMatchObject({ accessToken: "long-token" });
  });

  it("exchanges against the same redirect the dialog was given, which Meta requires to match exactly", async () => {
    const fetchImpl = exchangeFetch();
    const { service } = await setup({ fetchImpl });
    await signInFromWindow(service);
    const exchangeUrl = new URL(String((fetchImpl.mock.calls[0] as [string, RequestInit])[0]));
    expect(exchangeUrl.searchParams.get("redirect_uri")).toBe(DESKTOP_REDIRECT_URI);
  });

  it("refuses a URL that is not the redirect target rather than spending the issued state", async () => {
    // The shell should not have called at all. Treating it as a denial would burn the state and force the
    // person to start over for a navigation this app merely passed through.
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    await service.start({ flow: "desktop" });
    await expect(service.completeFromRedirect({ redirectedUrl: "https://www.facebook.com/login.php" }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("refuses a state that does not match the one it issued", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    await service.start({ flow: "desktop" });
    await expect(service.completeFromRedirect({ redirectedUrl: `${DESKTOP_REDIRECT_URI}?code=c&state=not-issued` }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects a malformed request body", async () => {
    const { service } = await setup();
    for (const body of [undefined, {}, { redirectedUrl: "" }, { redirectedUrl: "u", extra: 1 }]) {
      await expect(service.completeFromRedirect(body)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
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
      callbackLoginAvailable: true,
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
    await service.start({ flow: "desktop" });
    await expect(service.complete({ code: "c", state: "not-the-issued-state" }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect(fetchImpl).not.toHaveBeenCalled(); // never exchanged
  });

  it("spends an issued state exactly once", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    const started = await service.start({ flow: "desktop" });
    const state = new URL(started.url).searchParams.get("state")!;
    await service.complete({ code: "the-code", state });
    await expect(service.complete({ code: "the-code", state })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("refuses a state that has gone stale", async () => {
    let now = Date.parse("2026-08-27T00:00:00.000Z");
    const { service } = await setup({ fetchImpl: exchangeFetch(), now: () => now });
    const started = await service.start({ flow: "desktop" });
    const state = new URL(started.url).searchParams.get("state")!;
    now += 11 * 60 * 1000;
    await expect(service.complete({ code: "c", state }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("refuses a completion that was never started", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    await expect(service.complete({ code: "c", state: "whatever" }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("reports a refused sign-in rather than treating it as an exchange failure", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    const started = await service.start({ flow: "desktop" });
    const state = new URL(started.url).searchParams.get("state")!;
    await expect(service.complete({ error: "access_denied", state }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("surfaces a rejected exchange as a provider error, leaving no token behind", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "bad code", code: 100 } }));
    const { service } = await setup({ fetchImpl });
    const started = await service.start({ flow: "desktop" });
    const state = new URL(started.url).searchParams.get("state")!;
    await expect(service.complete({ code: "c", state }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_PROVIDER_ERROR" } });
    expect((await service.status()).tokenStored).toBe(false);
  });

  it("refuses a callback carrying nothing usable", async () => {
    const { service } = await setup();
    await service.start({ flow: "desktop" });
    await expect(service.complete({})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
});

describe("InstagramLoginService.lastLoginError", () => {
  /** Drives a sign-in that Meta refuses, the way the callback route does. */
  async function refusedSignIn(service: InstagramLoginService) {
    const started = await service.start({ flow: "callback" });
    const state = new URL(started.url).searchParams.get("state")!;
    await expect(service.complete({ code: "the-code", state })).rejects.toMatchObject({});
  }

  it("reports a refused sign-in, so the screen watching for a token stops instead of waiting out its timeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "Error validating client secret.", code: 1 } }));
    const { service } = await setup({ fetchImpl });
    await refusedSignIn(service);

    // The same code the failed request itself carries, so the screen reuses the message table it already has.
    await expect(service.status()).resolves.toMatchObject({ lastLoginError: { code: "INSTAGRAM_PROVIDER_ERROR" } });
  });

  it("says nothing at all before anything has been attempted", async () => {
    // Absence has to mean "no attempt has anything to report" rather than "nothing has ever failed".
    const { service } = await setup();
    expect(await service.status()).not.toHaveProperty("lastLoginError");
  });

  it("forgets the refusal the moment a new sign-in starts", async () => {
    // 🔴 D-018: a failure kept independently of an attempt is one that eventually appears beside a login that
    // has just succeeded. Starting again is the person saying the last outcome is no longer the question.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "no", code: 1 } }));
    const { service } = await setup({ fetchImpl });
    await refusedSignIn(service);
    expect(await service.status()).toHaveProperty("lastLoginError");

    await service.start({ flow: "callback" });

    expect(await service.status()).not.toHaveProperty("lastLoginError");
  });

  it("forgets the refusal once a sign-in succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(400, { error: { message: "no", code: 1 } }));
    const { service } = await setup({ fetchImpl });
    await refusedSignIn(service);

    fetchImpl.mockImplementation(exchangeFetch());
    await signIn(service);

    const status = await service.status();
    expect(status.tokenStored).toBe(true);
    expect(status).not.toHaveProperty("lastLoginError");
  });

  it("reports a refused state check too, not only a refusal by Meta", async () => {
    // The screen is waiting either way, and "your sign-in could not be verified" is as much an answer as
    // Meta refusing the exchange.
    const { service } = await setup();
    await service.start({ flow: "callback" });
    await expect(service.complete({ code: "c", state: "not-the-issued-one" })).rejects.toMatchObject({});

    await expect(service.status()).resolves.toMatchObject({ lastLoginError: { code: "INVALID_REQUEST" } });
  });

  it("invents nothing for a callback that no attempt was waiting on", async () => {
    const { service } = await setup();
    await expect(service.complete({ code: "c", state: "never-issued" })).rejects.toMatchObject({});
    expect(await service.status()).not.toHaveProperty("lastLoginError");
  });

  it("does not answer about the sign-in in progress with the outcome of the one before it", async () => {
    // Everything in the failing path is asynchronous, so a second press can land while the first is still
    // failing. The newer attempt owns the slot.
    const { service } = await setup({
      fetchImpl: vi.fn().mockImplementation(async () => {
        await service.start({ flow: "callback" });
        return jsonResponse(400, { error: { message: "no", code: 1 } });
      }),
    });
    await refusedSignIn(service);

    expect(await service.status()).not.toHaveProperty("lastLoginError");
  });

  it("is cleared by signing out", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "no", code: 1 } }));
    const { service } = await setup({ fetchImpl });
    await refusedSignIn(service);

    expect(await service.signOut()).not.toHaveProperty("lastLoginError");
  });
});

describe("InstagramLoginService.signOut", () => {
  it("forgets the token but keeps the app registration", async () => {
    const { service } = await setup({ fetchImpl: exchangeFetch() });
    await signIn(service);
    await expect(service.signOut()).resolves.toEqual({ appConfigured: true, tokenStored: false, callbackLoginAvailable: true });
  });

  it("reports not-connected when there is nothing registered to sign out of", async () => {
    const { service } = await setup({ app: false });
    await expect(service.signOut()).rejects.toMatchObject({ response: { code: "INSTAGRAM_NOT_CONNECTED" } });
  });
});
