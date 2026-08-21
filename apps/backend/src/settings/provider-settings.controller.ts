import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import {
  API_ROUTES,
  type GetProviderSettingsResponse,
  type SaveProviderCredentialResponse,
  type SetProviderConnectionResponse,
} from "@ai-animation-studio/shared";

import { ProviderSettingsService } from "./provider-settings.service.js";

@Controller()
export class ProviderSettingsController {
  constructor(private readonly settings: ProviderSettingsService) {}

  @Get(API_ROUTES.providerSettings)
  getSettings(): Promise<GetProviderSettingsResponse> { return this.settings.getSettings(); }

  @Put(`${API_ROUTES.providerSettings}/:provider/credential`)
  save(@Param("provider") provider: string, @Body() body: unknown): Promise<SaveProviderCredentialResponse> {
    return this.settings.save(provider, body);
  }

  @Post(`${API_ROUTES.providerSettings}/:provider/disconnect`)
  disconnect(@Param("provider") provider: string, @Body() body: unknown): Promise<SetProviderConnectionResponse> {
    return this.settings.disconnect(provider, body);
  }

  @Post(`${API_ROUTES.providerSettings}/:provider/reconnect`)
  reconnect(@Param("provider") provider: string, @Body() body: unknown): Promise<SetProviderConnectionResponse> {
    return this.settings.reconnect(provider, body);
  }
}
