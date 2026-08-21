import { describe, expect, it } from "vitest";

import {
  API_ROUTES,
  type GetProviderSettingsResponse,
  type ProviderCredentialKind,
  type SaveProviderCredentialRequest,
} from "./api.js";

describe("provider credential settings contract", () => {
  it("limits providers and centralizes every settings route", () => {
    const providers: ProviderCredentialKind[] = ["openai", "runway"];
    expect(providers).toEqual(["openai", "runway"]);
    expect(API_ROUTES.providerSettings).toBe("/settings/providers");
    expect(API_ROUTES.providerCredential("openai")).toBe("/settings/providers/openai/credential");
    expect(API_ROUTES.providerDisconnect("runway")).toBe("/settings/providers/runway/disconnect");
    expect(API_ROUTES.providerReconnect("runway")).toBe("/settings/providers/runway/reconnect");
  });

  it("exposes status-only DTOs without user identity or credential fields", () => {
    const request: SaveProviderCredentialRequest = { value: "temporary-test-value" };
    const response: GetProviderSettingsResponse = {
      providers: [{ provider: "openai", configured: true, connected: true, maskedValue: "sk-********abcd" }],
    };
    expect("userId" in request).toBe(false);
    expect("credential" in request).toBe(false);
    expect("value" in response.providers[0]!).toBe(false);
    expect("credential" in response.providers[0]!).toBe(false);
  });
});
