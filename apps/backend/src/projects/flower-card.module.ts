import { Module } from "@nestjs/common";

import { ProjectAssetMappingsModule } from "../mappings/mappings.module.js";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { FlowerCardController } from "./flower-card.controller.js";
import { FlowerCardService } from "./flower-card.service.js";
import { ProjectsModule } from "./projects.module.js";
import { LocalProjectRepository } from "./projects.repository.js";

/**
 * Its own module rather than a provider inside `ProjectsModule`, for the reason `StoryModule` is one: this
 * service needs the mapping review service, and `ProjectAssetMappingsModule` already imports `ProjectsModule`.
 * Wiring it the other way round would close that circle. So it sits above both and pulls from each, which is
 * also the honest picture — making a flower reel is a project write *and* a mapping baseline, and neither module
 * owns both halves.
 */
@Module({
  imports: [ProjectsModule, ProjectAssetMappingsModule],
  controllers: [FlowerCardController],
  providers: [
    {
      provide: FlowerCardService,
      useFactory: (projects: LocalProjectRepository, mappings: ProjectAssetMappingsService) => new FlowerCardService(projects, mappings),
      inject: [LocalProjectRepository, ProjectAssetMappingsService],
    },
  ],
})
export class FlowerCardModule {}
