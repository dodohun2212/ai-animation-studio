import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";
import { ProjectsModule } from "./projects/projects.module.js";

@Module({ imports: [ProjectsModule], controllers: [HealthController] })
export class AppModule {}
