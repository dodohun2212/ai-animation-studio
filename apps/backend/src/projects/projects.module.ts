import * as path from "node:path";

import { Module } from "@nestjs/common";

import { AssetsModule } from "../assets/assets.module.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { OrphanedGenerationRecoveryService } from "./orphaned-generation-recovery.service.js";
import { ProjectsController } from "./projects.controller.js";
import { PhotoCardController } from "./photo-card.controller.js";
import { PhotoCardService } from "./photo-card.service.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";
import { SceneEditService } from "./scene-edit.service.js";

export const PROJECTS_ROOT = "PROJECTS_ROOT";

/**
 * `learning_data` relative to the cwd, which for every real launch is `apps/backend` — see story-prompt.service.ts
 * for why that is consistent rather than accidental.
 *
 * The repository root used to hold a directory of the same name — the Python baseline's data — and telling the
 * two apart was its own decision (D-032). That copy was deleted on 2026-09-02 at the user's request, so there
 * is one `learning_data` now and it is this one. The reason the distinction mattered has not gone away: this
 * path still depends on the process's working directory, so a backend started from the repository root writes
 * a fresh, empty tree there instead of finding the person's projects.
 */
function defaultProjectsRoot(): string {
  return process.env.PROJECTS_ROOT ?? path.join(process.env.LEARNING_DATA_ROOT ?? path.join(process.cwd(), "learning_data"), "projects");
}

@Module({
  imports: [AssetsModule],
  controllers: [ProjectsController, PhotoCardController],
  providers: [
    { provide: PROJECTS_ROOT, useFactory: defaultProjectsRoot },
    {
      provide: PhotoCardService,
      useFactory: (projects: LocalProjectRepository, assets: LocalAssetsRepository, projectsRoot: string) => new PhotoCardService(projects, assets, projectsRoot),
      inject: [LocalProjectRepository, LocalAssetsRepository, PROJECTS_ROOT],
    },
    {
      provide: LocalProjectRepository,
      useFactory: (projectsRoot: string) => new LocalProjectRepository(projectsRoot),
      inject: [PROJECTS_ROOT],
    },
    {
      provide: LocalProjectAssetMappingsRepository,
      useFactory: (projectsRoot: string) => new LocalProjectAssetMappingsRepository(projectsRoot),
      inject: [PROJECTS_ROOT],
    },
    {
      provide: ProjectsService,
      useFactory: (repository: LocalProjectRepository, assets: LocalAssetsRepository, mappings: LocalProjectAssetMappingsRepository) => new ProjectsService(repository, assets, mappings),
      inject: [LocalProjectRepository, LocalAssetsRepository, LocalProjectAssetMappingsRepository],
    },
    {
      provide: SceneEditService,
      useFactory: (repository: LocalProjectRepository, projectsRoot: string) => new SceneEditService(repository, projectsRoot),
      inject: [LocalProjectRepository, PROJECTS_ROOT],
    },
    {
      provide: OrphanedGenerationRecoveryService,
      useFactory: (repository: LocalProjectRepository) => new OrphanedGenerationRecoveryService(repository),
      inject: [LocalProjectRepository],
    },
  ],
  exports: [LocalProjectRepository, PROJECTS_ROOT],
})
export class ProjectsModule {}
