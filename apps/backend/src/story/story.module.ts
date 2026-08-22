import { Module } from "@nestjs/common";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { StoryPromptController } from "./story-prompt.controller.js";
import { StoryPromptService } from "./story-prompt.service.js";

@Module({
  imports: [ProjectsModule],
  controllers: [StoryPromptController],
  providers: [{
    provide: StoryPromptService,
    useFactory: (projects: LocalProjectRepository) => new StoryPromptService(projects),
    inject: [LocalProjectRepository],
  }],
})
export class StoryModule {}
