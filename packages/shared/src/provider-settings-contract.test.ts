import { describe, expect, it } from "vitest";

import {
  API_ROUTES,
  type GetProviderSettingsResponse,
  type ProviderCredentialKind,
  type SaveProviderCredentialRequest,
  type SaveProviderMonthlyBudgetRequest,
} from "./api.js";
import { DEFAULT_VIDEO_MODEL, VIDEO_MODEL_OPTIONS } from "./domain.js";

describe("provider credential settings contract", () => {
  it("limits providers and centralizes every settings route", () => {
    const providers: ProviderCredentialKind[] = ["openai", "runway"];
    expect(providers).toEqual(["openai", "runway"]);
    expect(API_ROUTES.providerSettings).toBe("/settings/providers");
    expect(API_ROUTES.providerCredential("openai")).toBe("/settings/providers/openai/credential");
    expect(API_ROUTES.providerDisconnect("runway")).toBe("/settings/providers/runway/disconnect");
    expect(API_ROUTES.providerReconnect("runway")).toBe("/settings/providers/runway/reconnect");
    expect(API_ROUTES.providerMonthlyBudget("openai")).toBe("/settings/providers/openai/monthly-budget");
    expect(API_ROUTES.videoModelSetting).toBe("/settings/video-model");
  });

  it("exposes status-only DTOs without user identity or credential fields", () => {
    const request: SaveProviderCredentialRequest = { value: "temporary-test-value" };
    const response: GetProviderSettingsResponse = {
      providers: [{ provider: "openai", configured: true, connected: true, maskedValue: "sk-********abcd" }],
      monthlyBudgets: [{ provider: "openai", monthlyLimitUsd: 10, isDefault: true, spentUsd: 1.95, remainingUsd: 8.05 }],
      videoModel: { selected: DEFAULT_VIDEO_MODEL, isDefault: true, options: VIDEO_MODEL_OPTIONS },
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

  /**
   * A model option carries its own price, because a picker whose price does not move is worse than no picker.
   *
   * Every quote, confirmation and budget preflight is computed from this number; a model chosen without one
   * would be charged at the previous model's rate and pass a check it should not.
   */
  it("prices every video model it offers, and defaults to one of them", () => {
    expect(VIDEO_MODEL_OPTIONS.length).toBeGreaterThan(0);
    for (const option of VIDEO_MODEL_OPTIONS) {
      expect(option.pricePerSecondUsd, `${option.id} has no usable rate`).toBeGreaterThan(0);
      expect(option.label.trim(), `${option.id} has no name to show`).not.toBe("");
      expect(option.ratios.length, `${option.id} claims no output shape`).toBeGreaterThan(0);
    }
    expect(VIDEO_MODEL_OPTIONS.map((option) => option.id)).toContain(DEFAULT_VIDEO_MODEL);
  });
});
