import * as fs from "node:fs";
import * as path from "node:path";
import express, { type Express } from "express";

/**
 * Serves a pre-built frontend bundle from the same origin as the API, so the
 * frontend's relative fetch paths (e.g. "/projects") work without a dev
 * proxy. Used only by the packaged Electron shell; local dev keeps using the
 * Vite dev server's proxy instead. Registering this before Nest's own
 * routing means unmatched static paths fall through to the API unaffected.
 */
export function serveFrontend(app: Express, directory: string): boolean {
  const indexPath = path.join(directory, "index.html");
  if (!fs.existsSync(indexPath)) return false;
  app.use(express.static(directory));
  return true;
}
