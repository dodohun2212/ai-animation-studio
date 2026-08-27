import { Module } from "@nestjs/common";

import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { PROVIDER_SETTINGS_ROOT, ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramLoginService } from "./instagram-login.service.js";
import { InstagramTargetsController } from "./instagram-targets.controller.js";
import { InstagramTargetsService } from "./instagram-targets.service.js";

@Module({
  imports: [AssetsModule, ProviderSettingsModule],
  controllers: [InstagramTargetsController],
  providers: [
    {
      // Under the credential root, not learning_data: this file holds the app secret and the token.
      provide: InstagramConnectionStore,
      useFactory: (root: string) => new InstagramConnectionStore(root),
      inject: [PROVIDER_SETTINGS_ROOT],
    },
    {
      provide: InstagramTargetsService,
      useFactory: (root: string, connection: InstagramConnectionStore) => new InstagramTargetsService(root, connection),
      inject: [LEARNING_DATA_ROOT, InstagramConnectionStore],
    },
    {
      provide: InstagramLoginService,
      useFactory: (connection: InstagramConnectionStore) => new InstagramLoginService(connection),
      inject: [InstagramConnectionStore],
    },
  ],
  exports: [InstagramTargetsService, InstagramLoginService, InstagramConnectionStore],
})
export class InstagramModule {}
