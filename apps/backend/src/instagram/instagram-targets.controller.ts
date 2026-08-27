import { Body, Controller, Get, Put } from "@nestjs/common";
import { API_ROUTES, type GetInstagramTargetsResponse, type SetInstagramTargetResponse } from "@ai-animation-studio/shared";

import { InstagramTargetsService } from "./instagram-targets.service.js";

@Controller()
export class InstagramTargetsController {
  constructor(private readonly targets: InstagramTargetsService) {}

  @Get(API_ROUTES.instagramTargets)
  list(): Promise<GetInstagramTargetsResponse> {
    return this.targets.list();
  }

  @Put(API_ROUTES.instagramTarget)
  select(@Body() body: unknown): Promise<SetInstagramTargetResponse> {
    return this.targets.select(body);
  }
}
