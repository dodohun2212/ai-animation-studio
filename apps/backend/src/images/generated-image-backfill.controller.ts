import { Controller, Post } from "@nestjs/common";
import type { BackfillGeneratedImageAssetsResponse } from "@ai-animation-studio/shared";
import { GeneratedImageBackfillService } from "./generated-image-backfill.service.js";

@Controller("assets")
export class GeneratedImageBackfillController {
  constructor(private readonly service: GeneratedImageBackfillService) {}

  @Post("backfill-generated-images")
  run(): Promise<BackfillGeneratedImageAssetsResponse> {
    return this.service.backfillAll();
  }
}
