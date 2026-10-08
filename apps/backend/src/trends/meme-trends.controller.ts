import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { API_ROUTES, type AnalyzeMemeVideoRequest, type MemeTrendFeedResponse, type MemeTrendWorkspace, type SaveMemeObservationCardsRequest } from "@ai-animation-studio/shared";

import { MemeTrendsService } from "./meme-trends.service.js";
import { MemeObservationService } from "./meme-observation.service.js";

@Controller()
export class MemeTrendsController {
  constructor(private readonly trends: MemeTrendsService, private readonly observations: MemeObservationService) {}

  /** Opening or revisiting the feed must not spend YouTube search quota; only the named refresh action does. */
  @Get(API_ROUTES.memeTrends)
  get(): Promise<MemeTrendFeedResponse> { return this.trends.get(); }

  @Post(API_ROUTES.memeTrendsRefresh)
  refresh(): Promise<MemeTrendFeedResponse> { return this.trends.refresh(); }

  @Get("/trends/memes/:trendId/workspace")
  workspace(@Param("trendId") trendId: string): Promise<MemeTrendWorkspace> { return this.observations.get(trendId); }

  @Post("/trends/memes/:trendId/analysis")
  analyze(@Param("trendId") trendId: string, @Body() body: AnalyzeMemeVideoRequest): Promise<MemeTrendWorkspace> { return this.observations.analyze(trendId, body); }

  @Put("/trends/memes/:trendId/cards")
  saveCards(@Param("trendId") trendId: string, @Body() body: SaveMemeObservationCardsRequest): Promise<MemeTrendWorkspace> { return this.observations.saveCards(trendId, body); }

}
