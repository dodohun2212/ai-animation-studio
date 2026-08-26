import { Module } from "@nestjs/common";

import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { AudioLibraryController } from "./audio-library.controller.js";
import { AudioLibraryService } from "./audio-library.service.js";

@Module({
  imports: [AssetsModule],
  controllers: [AudioLibraryController],
  providers: [
    { provide: AudioLibraryService, useFactory: (root: string) => new AudioLibraryService(root), inject: [LEARNING_DATA_ROOT] },
  ],
  exports: [AudioLibraryService],
})
export class AudioModule {}
