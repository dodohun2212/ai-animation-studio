import { Module } from "@nestjs/common";

import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { PROVIDER_SETTINGS_ROOT, ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramLoginService } from "./instagram-login.service.js";
import { instagramCallbackUrl } from "./instagram-oauth.js";
import { InstagramTargetsController } from "./instagram-targets.controller.js";
import { InstagramPublishService } from "./instagram-publish.service.js";
import { InstagramTargetsService } from "./instagram-targets.service.js";
import { PROJECTS_ROOT, ProjectsModule } from "../projects/projects.module.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";

@Module({
  imports: [AssetsModule, ProviderSettingsModule, ProjectsModule],
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
      provide: InstagramPublishService,
      useFactory: (projects: LocalProjectRepository, root: string, connection: InstagramConnectionStore) =>
        new InstagramPublishService(projects, root, connection),
      inject: [LocalProjectRepository, PROJECTS_ROOT, InstagramConnectionStore],
    },
    {
      // Built from this process's own port so the browser dev server and the packaged shell each produce their
      // own address; both are registered once in the Meta app settings.
      provide: InstagramLoginService,
      useFactory: (connection: InstagramConnectionStore) =>
        new InstagramLoginService(connection, instagramCallbackUrl(Number(process.env.PORT ?? 3000))),
      inject: [InstagramConnectionStore],
    },
  ],
  exports: [InstagramTargetsService, InstagramLoginService, InstagramPublishService, InstagramConnectionStore],
})
export class InstagramModule {}
