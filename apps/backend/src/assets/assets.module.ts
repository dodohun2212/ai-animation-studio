import * as path from "node:path";
import { Module } from "@nestjs/common";
import { AssetsController } from "./assets.controller.js";
import { LocalAssetsRepository } from "./assets.repository.js";
import { AssetsService } from "./assets.service.js";

export const LEARNING_DATA_ROOT = "LEARNING_DATA_ROOT";
const defaultRoot = () => process.env.LEARNING_DATA_ROOT ?? path.join(process.cwd(), "learning_data");

@Module({
  controllers: [AssetsController],
  providers: [
    { provide: LEARNING_DATA_ROOT, useFactory: defaultRoot },
    { provide: LocalAssetsRepository, useFactory: (root: string) => new LocalAssetsRepository(root), inject: [LEARNING_DATA_ROOT] },
    AssetsService,
  ],
  exports: [LocalAssetsRepository, LEARNING_DATA_ROOT],
})
export class AssetsModule {}
