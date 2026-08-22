import { Module } from "@nestjs/common";
import { AssetsModule } from "../assets/assets.module.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { ProjectAssetMappingsModule } from "../mappings/mappings.module.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProjectsModule, PROJECTS_ROOT } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ImagesController } from "./images.controller.js";
import { LocalImageGenerationService } from "./local-image-generation.service.js";
import { ImageReviewService } from "./image-review.service.js";

@Module({
  imports: [ProjectsModule, ProjectAssetMappingsModule, AssetsModule],
  controllers: [ImagesController],
  providers: [{
    provide: LocalImageGenerationService,
    useFactory: (projects: LocalProjectRepository, mappings: LocalProjectAssetMappingsRepository, projectsRoot: string, assets: LocalAssetsRepository) =>
      new LocalImageGenerationService(projects, mappings, projectsRoot, undefined, assets),
    inject: [LocalProjectRepository, LocalProjectAssetMappingsRepository, PROJECTS_ROOT, LocalAssetsRepository],
  }, {
    provide: ImageReviewService,
    useFactory: (projects: LocalProjectRepository, projectsRoot: string, assets: LocalAssetsRepository) => new ImageReviewService(projects, projectsRoot, assets),
    inject: [LocalProjectRepository, PROJECTS_ROOT, LocalAssetsRepository],
  }],
})
export class ImagesModule {}
