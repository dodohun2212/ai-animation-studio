import * as path from "node:path";
import { Module } from "@nestjs/common";
import { AssetsController } from "./assets.controller.js";
import { LocalAssetsRepository } from "./assets.repository.js";
import { AssetsService } from "./assets.service.js";

export const LEARNING_DATA_ROOT = "LEARNING_DATA_ROOT";
/**
 * Relative to the cwd, which every real launch sets to `apps/backend` — see story-prompt.service.ts for why
 * that is consistent rather than accidental. The repository root held a directory of the same name until
 * 2026-09-02 (the Python baseline's data, D-032); it is gone, and what remains of the trap is the cwd itself:
 * launched from anywhere else, this resolves somewhere with no projects in it.
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
