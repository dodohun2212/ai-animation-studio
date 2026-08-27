import { describe, expect, it, vi } from "vitest";
import {
  INSTAGRAM_PUBLISH_SCOPES, exchangeCodeForToken, exchangeForLongLivedToken,
  inspectInstagramToken, instagramCallbackUrl, instagramLoginDialogUrl, readOAuthCallback,
} from "./instagram-oauth.js";

const REDIRECT = instagramCallbackUrl(4317);

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}
const noSleep = async () => {};

describe("instagramLoginDialogUrl", () => {
  it("builds the documented authorization dialog URL pointing back at this backend", () => {
    const url = new URL(instagramLoginDialogUrl("app-1", "state-1", REDIRECT));
    expect(`${url.origin}${url.pathname}`).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("response_type")).toBe("code");
    // Points back at this app's own backend, so no window has to be watched — the same flow works in a browser
    // tab and in the packaged shell.
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4317/settings/instagram/callback");
  });

  it("requests exactly the documented publishing permissions and nothing more", () => {
    const url = new URL(instagramLoginDialogUrl("app-1", "state-1", REDIRECT));
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "instagram_basic", "instagram_content_publish", "pages_read_engagement", "pages_show_list",
    ]);
    // Never asks for ad-account access this app has no use for.
    expect(url.searchParams.get("scope")).not.toContain("ads_");
  });

  it("rejects an empty app ID or state rather than building a URL that cannot be verified", () => {
    expect(() => instagramLoginDialogUrl("  ", "state-1", REDIRECT)).toThrow();
    expect(() => instagramLoginDialogUrl("app-1", "  ", REDIRECT)).toThrow();
  });
});

describe("readOAuthCallback", () => {
  it("returns the code and state Meta put on the callback", () => {
    expect(readOAuthCallback({ code: "the-code", state: "the-state" }))
      .toEqual({ kind: "code", code: "the-code", state: "the-state" });
  });

  it("reports a denial with Meta's description when the user refuses", () => {
    expect(readOAuthCallback({ error: "access_denied", error_description: "Permissions error" }))
      .toMatchObject({ kind: "denied", detail: "Permissions error" });
  });

  it("refuses a code that arrives without state, rather than trusting it", () => {
    // state is the only thing proving the code answers a login this app started.
    expect(readOAuthCallback({ code: "the-code" })).toMatchObject({ kind: "denied" });
  });

  it("reports an empty callback as a denial rather than throwing", () => {
    expect(readOAuthCallback({})).toEqual({ kind: "denied" });
  });
});

describe("instagramCallbackUrl", () => {
  it("uses the backend's own port, so each environment registers its own address", () => {
    expect(instagramCallbackUrl(3000)).toBe("http://127.0.0.1:3000/settings/instagram/callback");
    expect(instagramCallbackUrl(4317)).toBe("http://127.0.0.1:4317/settings/instagram/callback");
  });
});

describe("exchangeCodeForToken", () => {
  it("calls the documented token endpoint with the same redirect_uri used for the dialog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: "short-1", expires_in: 3600 }));
    const result = await exchangeCodeForToken("app-1", "secret-1", "code-1", REDIRECT, { fetchImpl: fetchMock, sleep: noSleep });
    expect(result).toEqual({ accessToken: "short-1", expiresInSeconds: 3600 });
    const url = new URL(String((fetchMock.mock.calls[0] as [string, RequestInit])[0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://graph.facebook.com/v26.0/oauth/access_token");
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("client_secret")).toBe("secret-1");
    expect(url.searchParams.get("code")).toBe("code-1");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
  });

  it("never retries — a login code is single-use, so a retry would send an already-consumed code", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(500, {})).mockResolvedValueOnce(jsonResponse(200, { access_token: "short-2" }));
    await expect(exchangeCodeForToken("app-1", "secret-1", "code-1", REDIRECT, { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 2 }))
      .rejects.toMatchObject({ category: "server" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty code without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(exchangeCodeForToken("app-1", "secret-1", "  ", REDIRECT, { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a response with no access_token as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    await expect(exchangeCodeForToken("app-1", "secret-1", "code-1", REDIRECT, { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "unknown" });
  });
});

describe("exchangeForLongLivedToken", () => {
  it("uses the documented fb_exchange_token grant and returns the ~60-day lifetime", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: "long-1", expires_in: 5184000 }));
    const result = await exchangeForLongLivedToken("app-1", "secret-1", "short-1", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result).toEqual({ accessToken: "long-1", expiresInSeconds: 5184000 });
    const url = new URL(String((fetchMock.mock.calls[0] as [string, RequestInit])[0]));
    expect(url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(url.searchParams.get("fb_exchange_token")).toBe("short-1");
    expect(url.searchParams.get("client_secret")).toBe("secret-1");
  });

  it("reports a null lifetime rather than guessing when Meta omits expires_in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: "long-2" }));
    await expect(exchangeForLongLivedToken("app-1", "secret-1", "short-1", { fetchImpl: fetchMock, sleep: noSleep }))
      .resolves.toEqual({ accessToken: "long-2", expiresInSeconds: null });
  });

  it("does retry a transient failure — unlike the code exchange, its input is not single-use", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "long-3", expires_in: 5184000 }));
    const result = await exchangeForLongLivedToken("app-1", "secret-1", "short-1", { fetchImpl: fetchMock, sleep: noSleep, maxRetries: 2 });
    expect(result.accessToken).toBe("long-3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("inspectInstagramToken", () => {
  it("calls debug_token with the documented app access token form and maps the response", async () => {
    const expiresAtUnix = 1_800_000_000;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      data: { is_valid: true, expires_at: expiresAtUnix, scopes: ["instagram_basic", "instagram_content_publish"], user_id: "u1" },
    }));
    const result = await inspectInstagramToken("app-1", "secret-1", "long-1", { fetchImpl: fetchMock, sleep: noSleep });
    expect(result).toEqual({
      isValid: true,
      expiresAt: new Date(expiresAtUnix * 1000).toISOString(),
      scopes: ["instagram_basic", "instagram_content_publish"],
    });
    const url = new URL(String((fetchMock.mock.calls[0] as [string, RequestInit])[0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://graph.facebook.com/v26.0/debug_token");
    expect(url.searchParams.get("input_token")).toBe("long-1");
    expect(url.searchParams.get("access_token")).toBe("app-1|secret-1");
  });

  it("reports a revoked token as invalid rather than throwing — that is the answer the caller asked for", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { is_valid: false, scopes: [] } }));
    await expect(inspectInstagramToken("app-1", "secret-1", "dead-token", { fetchImpl: fetchMock, sleep: noSleep }))
      .resolves.toMatchObject({ isValid: false, expiresAt: null });
  });

  it("reports no expiry as null instead of asserting a meaning for expires_at 0", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { is_valid: true, expires_at: 0, scopes: [] } }));
    await expect(inspectInstagramToken("app-1", "secret-1", "long-1", { fetchImpl: fetchMock, sleep: noSleep }))
      .resolves.toMatchObject({ expiresAt: null });
  });

  it("rejects an unparseable inspection response as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: {} }));
    await expect(inspectInstagramToken("app-1", "secret-1", "long-1", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "unknown" });
  });

  it("rejects an empty token without calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(inspectInstagramToken("app-1", "secret-1", "  ", { fetchImpl: fetchMock, sleep: noSleep }))
      .rejects.toMatchObject({ category: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("INSTAGRAM_PUBLISH_SCOPES", () => {
  it("stays pinned to the documented set so a silent widening is a test failure, not a surprise consent screen", () => {
    expect([...INSTAGRAM_PUBLISH_SCOPES]).toEqual([
      "instagram_basic", "instagram_content_publish", "pages_read_engagement", "pages_show_list",
    ]);
  });
});
