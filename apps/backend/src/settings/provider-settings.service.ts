import { Injectable } from "@nestjs/common";
import type {
  GetProviderSettingsResponse,
  ProviderCredentialKind,
  ProviderCredentialStatus,
  SaveProviderCredentialRequest,
  SaveProviderCredentialResponse,
  SetProviderConnectionResponse,
} from "@ai-animation-studio/shared";

import { credentialNotConfigured, invalidCredential, invalidSettingsRequest, unknownProvider } from "./provider-settings.error.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";
import { ProviderSettingsLogger } from "./provider-settings.redaction.js";

const PROVIDERS: readonly ProviderCredentialKind[] = ["openai", "runway"];

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

export function maskCredential(value: string): string {
  return `${value.slice(0, 3)}********${value.slice(-4)}`;
}

@Injectable()
export class ProviderSettingsService {
  private readonly disconnected = new Set<ProviderCredentialKind>();

  constructor(
    private readonly repository: ProviderSettingsRepository,
    private readonly logger = new ProviderSettingsLogger(),
  ) {}

  async getSettings(): Promise<GetProviderSettingsResponse> {
    return { providers: await Promise.all(PROVIDERS.map((provider) => this.status(provider))) };
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
