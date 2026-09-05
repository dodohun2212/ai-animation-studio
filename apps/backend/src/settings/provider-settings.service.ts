import { Injectable } from "@nestjs/common";
import type {
  GetProviderSettingsResponse,
  ProviderCredentialKind,
  ProviderCredentialStatus,
  ProviderMonthlyBudget,
  SaveProviderCredentialRequest,
  SaveProviderCredentialResponse,
  SaveProviderMonthlyBudgetRequest,
  SaveProviderMonthlyBudgetResponse,
  SetProviderConnectionResponse,
} from "@ai-animation-studio/shared";

import { credentialNotConfigured, invalidBudgetLimit, invalidCredential, invalidSettingsRequest, unknownProvider } from "./provider-settings.error.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";
import { ProviderSettingsLogger } from "./provider-settings.redaction.js";
import { DEFAULT_MONTHLY_LIMIT_USD } from "../providers/monthly-budget-limit.js";

const PROVIDERS: readonly ProviderCredentialKind[] = ["openai", "runway"];
/** The same names the budgets read, so the screen and the environment are one knob rather than two. */
const BUDGET_VARIABLE: Record<ProviderCredentialKind, string> = {
  openai: "OPENAI_MONTHLY_BUDGET_USD",
  runway: "RUNWAY_MONTHLY_BUDGET_USD",
};

/**
 * Rejects anything that is not a positive finite amount, and refuses to round.
 *
 * Cents are the smallest unit anyone means here, so more precision than that is a number nobody typed on
 * purpose — silently keeping it would show a limit on the settings screen that is not the one entered.
 */
function validateMonthlyLimit(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidSettingsRequest("Request body must contain only monthlyLimitUsd.");
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length !== 1 || entries[0]?.[0] !== "monthlyLimitUsd") throw invalidSettingsRequest("Request body must contain only monthlyLimitUsd.");
  const value = (body as SaveProviderMonthlyBudgetRequest).monthlyLimitUsd;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw invalidBudgetLimit();
  if (Math.round(value * 100) !== value * 100) throw invalidBudgetLimit();
  return value;
}

function validateProvider(value: string): ProviderCredentialKind {
  if (!PROVIDERS.includes(value as ProviderCredentialKind)) throw unknownProvider();
  return value as ProviderCredentialKind;
}

function validateCredentialRequest(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidSettingsRequest("Request body must contain only value.");
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length !== 1 || entries[0]?.[0] !== "value" || typeof entries[0][1] !== "string") {
    throw invalidSettingsRequest("Request body must contain only a string value.");
  }
  const value = entries[0][1].trim();
  if (value.length < 20 || /\s/.test(value)) throw invalidCredential();
  return value;
}

function validateEmptyBody(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body !== "object" || Array.isArray(body) || Object.keys(body as object).length !== 0) {
    throw invalidSettingsRequest("This request body must be empty.");
  }
}

/** Only what this service asks of a budget — the two ledgers live in providers/, and this module does not own them. */
export interface MonthlyBudgetReader {
  monthlyLimit(): Promise<number>;
  spentThisMonth(): Promise<number>;
  remaining(): Promise<number>;
}

export function maskCredential(value: string): string {
  return `${value.slice(0, 3)}********${value.slice(-4)}`;
}

@Injectable()
export class ProviderSettingsService {
  private readonly disconnected = new Set<ProviderCredentialKind>();
  private readonly logger = new ProviderSettingsLogger();

  /**
   * `budgets` is optional because this service is also constructed in contexts that have no ledger to read —
   * leaving it out reports the limit with the spend marked unavailable rather than inventing a zero.
   */
  constructor(private readonly repository: ProviderSettingsRepository, private readonly budgets?: Partial<Record<ProviderCredentialKind, MonthlyBudgetReader>>) {}

  async getSettings(): Promise<GetProviderSettingsResponse> {
    const [providers, monthlyBudgets] = await Promise.all([
      Promise.all(PROVIDERS.map((provider) => this.status(provider))),
      Promise.all(PROVIDERS.map((provider) => this.monthlyBudget(provider))),
    ]);
    return { providers, monthlyBudgets };
  }

  async saveMonthlyBudget(providerValue: string, body: unknown): Promise<SaveProviderMonthlyBudgetResponse> {
    const provider = validateProvider(providerValue);
    const monthlyLimitUsd = validateMonthlyLimit(body);
    await this.repository.saveNamed(BUDGET_VARIABLE[provider], String(monthlyLimitUsd));
    return { budget: await this.monthlyBudget(provider) };
  }

  /**
   * The limit and what has been spent against it, read the same way the refusal reads them.
   *
   * The spend comes from the ledger a budget would consult, so this screen cannot show a figure that disagrees
   * with the one that stops a request. A ledger that will not read leaves `spendUnavailable` rather than a
   * zero: this screen has no business claiming nothing has been spent, and the limit itself is still true and
   * still worth showing and changing.
   */
  private async monthlyBudget(provider: ProviderCredentialKind): Promise<ProviderMonthlyBudget> {
    const budget = this.budgets?.[provider];
    const stored = await this.repository.readNamed(BUDGET_VARIABLE[provider]).catch(() => null);
    const monthlyLimitUsd = budget ? await budget.monthlyLimit() : DEFAULT_MONTHLY_LIMIT_USD;
    const isDefault = stored === null && !process.env[BUDGET_VARIABLE[provider]];
    if (!budget) return { provider, monthlyLimitUsd, isDefault, spentUsd: 0, remainingUsd: monthlyLimitUsd, spendUnavailable: true };
    try {
      const [spentUsd, remainingUsd] = await Promise.all([budget.spentThisMonth(), budget.remaining()]);
      return { provider, monthlyLimitUsd, isDefault, spentUsd, remainingUsd };
    } catch {
      return { provider, monthlyLimitUsd, isDefault, spentUsd: 0, remainingUsd: monthlyLimitUsd, spendUnavailable: true };
    }
  }

  async save(providerValue: string, body: unknown): Promise<SaveProviderCredentialResponse> {
    const provider = validateProvider(providerValue);
    const value = validateCredentialRequest(body as SaveProviderCredentialRequest);
    await this.repository.save(provider, value);
    this.logger.rememberCredential(value);
    this.disconnected.delete(provider);
    return { provider: await this.status(provider) };
  }

  async disconnect(providerValue: string, body: unknown): Promise<SetProviderConnectionResponse> {
    const provider = validateProvider(providerValue);
    validateEmptyBody(body);
    this.disconnected.add(provider);
    return { provider: await this.status(provider) };
  }

  async reconnect(providerValue: string, body: unknown): Promise<SetProviderConnectionResponse> {
    const provider = validateProvider(providerValue);
    validateEmptyBody(body);
    if (!(await this.repository.read(provider))) throw credentialNotConfigured();
    this.disconnected.delete(provider);
    return { provider: await this.status(provider) };
  }

  /** Returns the raw credential only when it is both configured and not session-disconnected — never logged or exposed over the API. */
  async rawCredentialIfConnected(providerValue: ProviderCredentialKind): Promise<string | null> {
    if (this.disconnected.has(providerValue)) return null;
    return this.repository.read(providerValue);
  }

  private async status(provider: ProviderCredentialKind): Promise<ProviderCredentialStatus> {
    const value = await this.repository.read(provider);
    if (value) this.logger.rememberCredential(value);
    return {
      provider,
      configured: value !== null,
      connected: value !== null && !this.disconnected.has(provider),
      maskedValue: value === null ? null : maskCredential(value),
    };
  }
}
