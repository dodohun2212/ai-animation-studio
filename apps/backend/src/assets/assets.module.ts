import * as path from "node:path";
import { Module } from "@nestjs/common";
import { AssetsController } from "./assets.controller.js";
import { LocalAssetsRepository } from "./assets.repository.js";
import { AssetsService } from "./assets.service.js";

export const LEARNING_DATA_ROOT = "LEARNING_DATA_ROOT";
/**
 * Relative to the cwd, which every real launch sets to `apps/backend` — see story-prompt.service.ts for why
 * that is consistent rather than accidental, and D-032 for the trap: the repository root holds a directory of
 * the same name that belongs to the Python baseline and is tracked in git. Nothing here writes there. Before
 * citing a file on disk as evidence of what the app stored, say which of the two you opened.
 */
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
