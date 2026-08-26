import * as path from "node:path";

import { Module } from "@nestjs/common";

import { AssetsModule } from "../assets/assets.module.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { OrphanedGenerationRecoveryService } from "./orphaned-generation-recovery.service.js";
import { ProjectsController } from "./projects.controller.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";
import { SceneEditService } from "./scene-edit.service.js";

export const PROJECTS_ROOT = "PROJECTS_ROOT";

function defaultProjectsRoot(): string {
  return process.env.PROJECTS_ROOT ?? path.join(process.env.LEARNING_DATA_ROOT ?? path.join(process.cwd(), "learning_data"), "projects");
}

@Module({
  imports: [AssetsModule],
  controllers: [ProjectsController],
  providers: [
    { provide: PROJECTS_ROOT, useFactory: defaultProjectsRoot },
    {
      provide: LocalProjectRepository,
      useFactory: (projectsRoot: string) => new LocalProjectRepository(projectsRoot),
      inject: [PROJECTS_ROOT],
    },
    {
      provide: ProjectsService,
      useFactory: (repository: LocalProjectRepository, assets: LocalAssetsRepository) => new ProjectsService(repository, assets),
      inject: [LocalProjectRepository, LocalAssetsRepository],
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
