import { describe, expect, it } from "vitest";

import {
  API_ROUTES,
  type GetProviderSettingsResponse,
  type ProviderCredentialKind,
  type SaveProviderCredentialRequest,
  type SaveProviderMonthlyBudgetRequest,
} from "./api.js";

describe("provider credential settings contract", () => {
  it("limits providers and centralizes every settings route", () => {
    const providers: ProviderCredentialKind[] = ["openai", "runway"];
    expect(providers).toEqual(["openai", "runway"]);
    expect(API_ROUTES.providerSettings).toBe("/settings/providers");
    expect(API_ROUTES.providerCredential("openai")).toBe("/settings/providers/openai/credential");
    expect(API_ROUTES.providerDisconnect("runway")).toBe("/settings/providers/runway/disconnect");
    expect(API_ROUTES.providerReconnect("runway")).toBe("/settings/providers/runway/reconnect");
    expect(API_ROUTES.providerMonthlyBudget("openai")).toBe("/settings/providers/openai/monthly-budget");
  });

  it("exposes status-only DTOs without user identity or credential fields", () => {
    const request: SaveProviderCredentialRequest = { value: "temporary-test-value" };
    const response: GetProviderSettingsResponse = {
      providers: [{ provider: "openai", configured: true, connected: true, maskedValue: "sk-********abcd" }],
      monthlyBudgets: [{ provider: "openai", monthlyLimitUsd: 10, isDefault: true, spentUsd: 1.95, remainingUsd: 8.05 }],
    };
    expect("userId" in request).toBe(false);
    expect("credential" in request).toBe(false);
    expect("value" in response.providers[0]!).toBe(false);
    expect("credential" in response.providers[0]!).toBe(false);
  });

  /**
   * The spend limit is a number, and the request carries nothing else.
   *
   * It is the one settings value that decides whether paid work is refused, so a request that could carry a
   * provider name or a spend figure alongside it would be a request that could disagree with the route it was
   * sent to, or claim to have spent something.
   */
  it("takes only the limit itself, with the provider named by the route", () => {
    const request: SaveProviderMonthlyBudgetRequest = { monthlyLimitUsd: 25 };
    expect(Object.keys(request)).toEqual(["monthlyLimitUsd"]);
  });
});
