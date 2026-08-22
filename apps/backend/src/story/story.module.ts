import { Module } from "@nestjs/common";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { ProjectAssetMappingsModule } from "../mappings/mappings.module.js";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { StoryPromptController } from "./story-prompt.controller.js";
import { StoryPromptService } from "./story-prompt.service.js";

@Module({
  imports: [ProjectsModule, ProjectAssetMappingsModule],
  controllers: [StoryPromptController],
  providers: [{
    provide: StoryPromptService,
    useFactory: (projects: LocalProjectRepository, mappings: ProjectAssetMappingsService) => new StoryPromptService(projects, undefined, mappings),
    inject: [LocalProjectRepository, ProjectAssetMappingsService],
  }],
})
export class StoryModule {}
