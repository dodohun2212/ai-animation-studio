import { Controller, Get, Post } from "@nestjs/common";
import { API_ROUTES, type MemeTrendFeedResponse } from "@ai-animation-studio/shared";

import { MemeTrendsService } from "./meme-trends.service.js";

@Controller()
export class MemeTrendsController {
  constructor(private readonly trends: MemeTrendsService) {}

  /** Opening or revisiting the feed must not spend YouTube search quota; only the named refresh action does. */
  @Get(API_ROUTES.memeTrends)
  get(): Promise<MemeTrendFeedResponse> { return this.trends.get(); }

  @Post(API_ROUTES.memeTrendsRefresh)
  refresh(): Promise<MemeTrendFeedResponse> { return this.trends.refresh(); }

}
