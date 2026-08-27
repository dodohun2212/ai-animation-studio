import { Body, Controller, Delete, Get, Post, Put } from "@nestjs/common";
import {
  API_ROUTES,
  type CompleteInstagramLoginResponse, type GetInstagramTargetsResponse, type InstagramConnectionStatus,
  type SetInstagramAppResponse, type SetInstagramTargetResponse, type StartInstagramLoginResponse,
} from "@ai-animation-studio/shared";

import { InstagramLoginService } from "./instagram-login.service.js";
import { InstagramTargetsService } from "./instagram-targets.service.js";

@Controller()
export class InstagramTargetsController {
  constructor(
    private readonly targets: InstagramTargetsService,
    private readonly login: InstagramLoginService,
  ) {}

  @Get(API_ROUTES.instagramTargets)
  list(): Promise<GetInstagramTargetsResponse> {
    return this.targets.list();
  }

  @Put(API_ROUTES.instagramTarget)
  select(@Body() body: unknown): Promise<SetInstagramTargetResponse> {
    return this.targets.select(body);
  }

  @Get(API_ROUTES.instagramConnection)
  connection(): Promise<InstagramConnectionStatus> {
    return this.login.status();
  }

  @Put(API_ROUTES.instagramApp)
  saveApp(@Body() body: unknown): Promise<SetInstagramAppResponse> {
    return this.login.saveApp(body);
  }

  /** Returns the URL to open and the prefix that marks arrival; the window itself is the desktop shell's job. */
  @Post(API_ROUTES.instagramLoginStart)
  startLogin(): Promise<StartInstagramLoginResponse> {
    return this.login.start();
  }

  @Post(API_ROUTES.instagramLoginComplete)
  completeLogin(@Body() body: unknown): Promise<CompleteInstagramLoginResponse> {
    return this.login.complete(body);
  }

  @Delete(API_ROUTES.instagramConnection)
  signOut(): Promise<InstagramConnectionStatus> {
    return this.login.signOut();
  }
}
