import { Body, Controller, Post } from "@nestjs/common";
import type { CreatePhotoCardResponse } from "@ai-animation-studio/shared";
import { PhotoCardService } from "./photo-card.service.js";

@Controller("photo-cards")
export class PhotoCardController {
  constructor(private readonly service: PhotoCardService) {}

  @Post()
  create(@Body() body: unknown): Promise<CreatePhotoCardResponse> {
    return this.service.create(body);
  }
}
