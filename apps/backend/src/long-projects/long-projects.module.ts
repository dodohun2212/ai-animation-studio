import { Module } from "@nestjs/common";
import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { LongProjectsController } from "./long-projects.controller.js";
import { LongProjectsService } from "./long-projects.service.js";

@Module({ imports: [ProjectsModule], controllers: [LongProjectsController], providers: [{ provide: LongProjectsService, useFactory: (projectsRoot: string) => new LongProjectsService(projectsRoot), inject: [PROJECTS_ROOT] }] })
export class LongProjectsModule {}
