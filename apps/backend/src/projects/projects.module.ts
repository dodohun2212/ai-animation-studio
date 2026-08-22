import * as path from "node:path";

import { Module } from "@nestjs/common";

import { ProjectsController } from "./projects.controller.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";

export const PROJECTS_ROOT = "PROJECTS_ROOT";

function defaultProjectsRoot(): string {
  return process.env.PROJECTS_ROOT ?? path.join(process.cwd(), "learning_data", "projects");
}

@Module({
  controllers: [ProjectsController],
  providers: [
    { provide: PROJECTS_ROOT, useValue: defaultProjectsRoot() },
    {
      provide: LocalProjectRepository,
      useFactory: (projectsRoot: string) => new LocalProjectRepository(projectsRoot),
      inject: [PROJECTS_ROOT],
    },
    ProjectsService,
  ],
  exports: [LocalProjectRepository],
})
export class ProjectsModule {}
