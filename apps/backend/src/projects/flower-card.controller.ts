import { Body, Controller, Post } from "@nestjs/common";
import type { CreateFlowerCardResponse } from "@ai-animation-studio/shared";
import { FlowerCardService } from "./flower-card.service.js";

@Controller("flower-cards")
export class FlowerCardController {
  constructor(private readonly service: FlowerCardService) {}

  @Post()
  create(@Body() body: unknown): Promise<CreateFlowerCardResponse> {
    return this.service.create(body);
  }
}
