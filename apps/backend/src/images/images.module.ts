import { Module } from "@nestjs/common";
import { ProjectAssetMappingsModule } from "../mappings/mappings.module.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProjectsModule, PROJECTS_ROOT } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ImagesController } from "./images.controller.js";
import { LocalImageGenerationService } from "./local-image-generation.service.js";

@Module({
  imports: [ProjectsModule, ProjectAssetMappingsModule],
  controllers: [ImagesController],
  providers: [{
    provide: LocalImageGenerationService,
    useFactory: (projects: LocalProjectRepository, mappings: LocalProjectAssetMappingsRepository, projectsRoot: string) =>
      new LocalImageGenerationService(projects, mappings, projectsRoot),
    inject: [LocalProjectRepository, LocalProjectAssetMappingsRepository, PROJECTS_ROOT],
  }],
})
export class ImagesModule {}
