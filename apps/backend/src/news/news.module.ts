import { Module } from "@nestjs/common";

import { AssetsModule, LEARNING_DATA_ROOT } from "../assets/assets.module.js";
import { ProviderSettingsModule } from "../settings/provider-settings.module.js";
import { NewsCallQuota } from "./news-call-quota.js";
import { NewsController } from "./news.controller.js";

@Module({
  imports: [AssetsModule, ProviderSettingsModule],
  controllers: [NewsController],
  providers: [
    { provide: NewsCallQuota, useFactory: (root: string) => new NewsCallQuota(root), inject: [LEARNING_DATA_ROOT] },
  ],
})
export class NewsModule {}
