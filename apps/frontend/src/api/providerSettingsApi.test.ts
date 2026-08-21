import type { GetProviderSettingsResponse } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disconnectProvider,
  getProviderSettings,
  ProviderSettingsApiError,
  reconnectProvider,
  saveProviderCredential,
  toDisplayError,
} from "./providerSettingsApi.js";
import { jsonResponse, makeProviderStatus, nonJsonResponse } from "./testUtils.js";

describe("providerSettingsApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches settings via GET /settings/providers", async () => {
    const responseBody: GetProviderSettingsResponse = {
      providers: [makeProviderStatus({ provider: "openai" }), makeProviderStatus({ provider: "runway" })],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responseBody));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getProviderSettings()).toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith("/settings/providers");
  });

  it("handles openai/runway regardless of response order, keyed by the provider field", async () => {
    const reversed: GetProviderSettingsResponse = {
      providers: [makeProviderStatus({ provider: "runway" }), makeProviderStatus({ provider: "openai" })],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, reversed)));

    const result = await getProviderSettings();
    expect(result.providers.map((item) => item.provider)).toEqual(["runway", "openai"]);
  });

  it("saves a credential via PUT with a body containing exactly { value }", async () => {
    const project = makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { provider: project }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveProviderCredential("openai", "sk-test-credential-1234567890");

    expect(result).toEqual({ provider: project });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/providers/openai/credential");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ value: "sk-test-credential-1234567890" });
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(["value"]);
  });

  it("sends no credential and no body on disconnect", async () => {
    const status = makeProviderStatus({
      provider: "openai",
      configured: true,
      connected: false,
      maskedValue: "sk-********7890",
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { provider: status }));
    vi.stubGlobal("fetch", fetchMock);

    await disconnectProvider("openai");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/providers/openai/disconnect");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("sends no credential and no body on reconnect", async () => {
    const status = makeProviderStatus({
      provider: "runway",
      configured: true,
      connected: true,
      maskedValue: "rw-********7890",
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { provider: status }));
    vi.stubGlobal("fetch", fetchMock);

    await reconnectProvider("runway");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/providers/runway/reconnect");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  describe.each([
    "INVALID_REQUEST",
    "UNKNOWN_PROVIDER",
    "INVALID_CREDENTIAL",
    "CREDENTIAL_NOT_CONFIGURED",
    "SETTINGS_FILE_MALFORMED",
    "SETTINGS_STORAGE_ERROR",
  ])("Backend error code %s", (code) => {
    it("is preserved verbatim on the thrown ProviderSettingsApiError", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code, message: `${code} 메시지` })));

      await expect(getProviderSettings()).rejects.toMatchObject({ code, message: `${code} 메시지` });
    });
  });

  it("converts fetch() itself throwing (network failure) into a safe ProviderSettingsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await getProviderSettings().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderSettingsApiError);
    expect((error as ProviderSettingsApiError).code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("converts a non-JSON success response into a safe ProviderSettingsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(200)));

    await expect(getProviderSettings()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("converts a malformed success envelope into a safe ProviderSettingsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { providers: "not-an-array" })));

    await expect(getProviderSettings()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("converts a non-JSON error response into a safe ProviderSettingsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(500)));

    await expect(getProviderSettings()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a response containing an invalid provider value", async () => {
    const invalid = { providers: [makeProviderStatus({ provider: "openai" }), { ...makeProviderStatus(), provider: "azure" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, invalid)));

    await expect(getProviderSettings()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a response with a duplicate provider entry", async () => {
    const duplicated = {
      providers: [makeProviderStatus({ provider: "openai" }), makeProviderStatus({ provider: "openai" })],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, duplicated)));

    await expect(getProviderSettings()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a response missing a required provider entry", async () => {
    const missingRunway = { providers: [makeProviderStatus({ provider: "openai" })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, missingRunway)));

    await expect(getProviderSettings()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a contradictory status: configured=false but maskedValue is a string", async () => {
    const contradictory = {
      providers: [
        makeProviderStatus({ provider: "openai", configured: false, maskedValue: "sk-********7890" }),
        makeProviderStatus({ provider: "runway" }),
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, contradictory)));

    await expect(getProviderSettings()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a contradictory status: connected=true but configured=false", async () => {
    const contradictory = {
      providers: [
        makeProviderStatus({ provider: "openai", configured: false, connected: true }),
        makeProviderStatus({ provider: "runway" }),
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, contradictory)));

    await expect(getProviderSettings()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it.each([
    "ab********7890",
    "abc*******7890",
    "abc********789",
    "abc********78901",
    "a c********7890",
    "abc********78 0",
  ])("rejects configured credentials whose mask does not exactly match the backend shape: %s", async (maskedValue) => {
    const invalid = { providers: [
      makeProviderStatus({ provider: "openai", configured: true, maskedValue }),
      makeProviderStatus({ provider: "runway" }),
    ] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, invalid)));
    await expect(getProviderSettings()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a mutation response for a provider other than the requested provider", async () => {
    const runway = makeProviderStatus({ provider: "runway", configured: true, connected: true, maskedValue: "run********7890" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { provider: runway })));
    await expect(saveProviderCredential("openai", "sk-test-credential-1234567890"))
      .rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("never leaks local paths or raw response bodies into the error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { stack: "at C:\\Users\\secret\\project\\file.ts:42", oops: true })),
    );

    const error = (await getProviderSettings().catch((caught: unknown) => caught)) as ProviderSettingsApiError;
    expect(error.message).not.toContain("C:\\");
    expect(error.message).not.toContain("secret");
  });

  describe("toDisplayError", () => {
    it("passes through a ProviderSettingsApiError's code and message", () => {
      const error = new ProviderSettingsApiError("CREDENTIAL_NOT_CONFIGURED", "저장된 credential이 없습니다.");
      expect(toDisplayError(error)).toEqual({ code: "CREDENTIAL_NOT_CONFIGURED", message: "저장된 credential이 없습니다." });
    });

    it("falls back to a safe generic code/message for an unexpected error", () => {
      const result = toDisplayError(new Error("some internal detail"));
      expect(typeof result.code).toBe("string");
      expect(result.code.length).toBeGreaterThan(0);
      expect(result.message).not.toContain("some internal detail");
    });

    it("replaces an untrusted server error code with the fixed safe fallback", () => {
      const secretCode = "UNKNOWN_C:\\Users\\secret\\sk-live-value";
      const result = toDisplayError(new ProviderSettingsApiError(secretCode, "raw server message"));
      expect(result).toEqual({
        code: "CLIENT_UNKNOWN_ERROR",
        message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(JSON.stringify(result)).not.toContain("sk-live-value");
    });
  });
});
