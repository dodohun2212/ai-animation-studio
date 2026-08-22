import { Body, Controller, Param, Post } from "@nestjs/common";
import { API_ROUTES, type StartImageGenerationResponse } from "@ai-animation-studio/shared";
import { LocalImageGenerationService } from "./local-image-generation.service.js";

@Controller()
export class ImagesController {
  constructor(private readonly service: LocalImageGenerationService) {}

  @Post(`${API_ROUTES.projects}/:projectId/images/generations`)
  generate(@Param("projectId") projectId: string, @Body() body: unknown): Promise<StartImageGenerationResponse> {
    return this.service.generate(projectId, body);
  }
}
