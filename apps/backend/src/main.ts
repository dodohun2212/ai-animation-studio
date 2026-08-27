import * as https from "node:https";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Express } from "express";

import { AppModule } from "./app.module.js";
import { type CallbackTls, resolveCallbackTls } from "./instagram/instagram-callback-tls.js";
import { serveFrontend } from "./static-frontend.js";

/**
 * Serves the same application over TLS as well, on its own port, so Meta can redirect a browser back here.
 *
 * The express instance is the running app's own, not a second one: the login's issued `state` lives in memory on
 * a single service instance, so a separate process or a separate Nest app would answer the callback without ever
 * having issued the state it carries, and every browser login would be refused as unverifiable (D-022).
 *
 * A failure to listen rejects rather than being logged and stepped over. The connection status already told the
 * screen a browser login is available — an app that keeps running after this fails is one that says the door is
 * open while it is shut, which is the failure this whole arrangement is built to avoid.
 */
async function serveCallbackOverTls(handler: Express, tls: CallbackTls): Promise<void> {
  const server = https.createServer({ cert: tls.cert, key: tls.key }, handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(tls.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

async function bootstrap(): Promise<void> {
  // The one legitimate default, and it is only safe because every other launcher now sets this explicitly.
  // `npm run dev:backend` runs with apps/backend as its working directory, which is exactly where the saved
  // credential belongs; the desktop shell passes its own root rather than relying on this. That distinction is
  // the whole fix: while the shell left it unset, this line silently gave it a different drawer from the browser
  // dev server, and a key entered in one was invisible in the other. See ProviderSettingsModule's
  // requiredProviderSettingsRoot doc comment for why it refuses to guess when nothing sets it at all.
  process.env.PROVIDER_SETTINGS_ROOT ??= process.cwd();
  // Read before anything starts: a certificate that is half-configured or unreadable should stop the process
  // here, rather than after the app is up and has begun answering questions about which logins are possible.
  const tls = resolveCallbackTls(process.env);
  const app = await NestFactory.create(AppModule);
  const httpHandler = app.getHttpAdapter().getInstance() as Express;
  const frontendDirectory = process.env.FRONTEND_STATIC_DIR;
  if (frontendDirectory) serveFrontend(httpHandler, frontendDirectory);
  await app.listen(process.env.PORT ?? 3000, "127.0.0.1");
  if (tls) {
    await serveCallbackOverTls(httpHandler, tls);
    // Said out loud because a second listener is otherwise invisible, and this one is the difference between a
    // browser being able to sign in to Instagram and a window that waits and then reports nothing.
    new Logger("InstagramCallback").log(`Instagram callback listening on https://127.0.0.1:${tls.port}`);
  }
}

void bootstrap();
