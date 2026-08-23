import { Controller, Post } from "@nestjs/common";
import type { RunLegacyReferenceMigrationResponse } from "@ai-animation-studio/shared";
import { LegacyReferenceMigrationService } from "./legacy-reference-migration.service.js";

@Controller("assets")
export class LegacyReferenceMigrationController {
  constructor(private readonly service: LegacyReferenceMigrationService) {}

  @Post("legacy-migration")
  run(): Promise<RunLegacyReferenceMigrationResponse> {
    return this.service.migrateAll();
  }
}
