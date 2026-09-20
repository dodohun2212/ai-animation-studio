import { Body, Controller, Post } from "@nestjs/common";
import type { CreateNewsReelResponse } from "@ai-animation-studio/shared";

import { NewsReelService } from "./news-reel.service.js";

/* The path is written out rather than built from API_ROUTES at runtime: route-shape-coverage reads
   this decorator as text, and an expression it cannot resolve reads as a route with no handler. */
@Controller("news/reels")
export class NewsReelController {
  constructor(private readonly service: NewsReelService) {}

  @Post()
  create(@Body() body: unknown): Promise<CreateNewsReelResponse> {
    return this.service.create(body);
  }
}
