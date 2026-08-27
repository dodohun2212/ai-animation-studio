import { Module } from "@nestjs/common";

import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { PROVIDER_SETTINGS_ROOT, ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramLoginService } from "./instagram-login.service.js";
import { resolveCallbackTls } from "./instagram-callback-tls.js";
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
      // The callback address exists only where a certificate does, and its port comes from the same resolution
      // that the TLS listener is started from — so the address this service hands to Meta and the door that
      // answers it are the same one by construction, not by two places agreeing on a number (D-022).
      provide: InstagramLoginService,
      useFactory: (connection: InstagramConnectionStore) => {
        const tls = resolveCallbackTls(process.env);
        return new InstagramLoginService(connection, tls === null ? null : instagramCallbackUrl(tls.port));
      },
      inject: [InstagramConnectionStore],
    },
  ],
  exports: [InstagramTargetsService, InstagramLoginService, InstagramPublishService, InstagramConnectionStore],
})
export class InstagramModule {}
