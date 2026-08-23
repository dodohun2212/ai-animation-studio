import * as path from "node:path";
import { Module } from "@nestjs/common";
import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LegacyReferenceMigrationController } from "./legacy-reference-migration.controller.js";
import { LegacyReferenceMigrationService } from "./legacy-reference-migration.service.js";
import { ProjectAssetMappingsController } from "./mappings.controller.js";
import { LocalProjectAssetMappingsRepository } from "./mappings.repository.js";
import { ProjectAssetMappingsService } from "./mappings.service.js";

@Module({ imports: [AssetsModule, ProjectsModule], controllers: [ProjectAssetMappingsController, LegacyReferenceMigrationController], providers: [
  { provide: LocalProjectAssetMappingsRepository, useFactory: (root: string) => new LocalProjectAssetMappingsRepository(path.join(root, "projects")), inject: [LEARNING_DATA_ROOT] },
  { provide: ProjectAssetMappingsService, useFactory: (repository: LocalProjectAssetMappingsRepository, assets: LocalAssetsRepository, projects: LocalProjectRepository) => new ProjectAssetMappingsService(repository, assets, projects), inject: [LocalProjectAssetMappingsRepository, LocalAssetsRepository, LocalProjectRepository] },
  { provide: LegacyReferenceMigrationService, useFactory: (assets: LocalAssetsRepository, mappings: LocalProjectAssetMappingsRepository, root: string) => new LegacyReferenceMigrationService(assets, mappings, root), inject: [LocalAssetsRepository, LocalProjectAssetMappingsRepository, LEARNING_DATA_ROOT] },
] , exports: [LocalProjectAssetMappingsRepository, ProjectAssetMappingsService] })
export class ProjectAssetMappingsModule {}
