import * as path from "node:path";
import { Module } from "@nestjs/common";
import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { ProjectAssetMappingsController } from "./mappings.controller.js";
import { LocalProjectAssetMappingsRepository } from "./mappings.repository.js";
import { ProjectAssetMappingsService } from "./mappings.service.js";

@Module({ imports: [AssetsModule], controllers: [ProjectAssetMappingsController], providers: [
  { provide: LocalProjectAssetMappingsRepository, useFactory: (root: string) => new LocalProjectAssetMappingsRepository(path.join(root, "projects")), inject: [LEARNING_DATA_ROOT] },
  ProjectAssetMappingsService,
] , exports: [LocalProjectAssetMappingsRepository] })
export class ProjectAssetMappingsModule {}
