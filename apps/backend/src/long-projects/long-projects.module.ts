import { Module } from "@nestjs/common";
import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { LongProjectsController } from "./long-projects.controller.js";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleController } from "./story-bible.controller.js";
import { StoryBibleService } from "./story-bible.service.js";

@Module({ imports: [ProjectsModule], controllers: [LongProjectsController, StoryBibleController], providers: [{ provide: LongProjectsService, useFactory: (projectsRoot: string) => new LongProjectsService(projectsRoot), inject: [PROJECTS_ROOT] }, { provide: StoryBibleService, useFactory: (projectsRoot: string) => new StoryBibleService(projectsRoot), inject: [PROJECTS_ROOT] }] })
export class LongProjectsModule {}
