import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { serveFrontend } from "./static-frontend.js";

let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("serveFrontend", () => {
  it("serves index.html and nested static assets from the given directory", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "static-frontend-"));
    await fs.writeFile(path.join(directory, "index.html"), "<html>local shell</html>", "utf8");
    await fs.mkdir(path.join(directory, "assets"), { recursive: true });
    await fs.writeFile(path.join(directory, "assets", "app.js"), "console.log('ok');", "utf8");

    const app = express();
    expect(serveFrontend(app, directory)).toBe(true);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const base = `http://127.0.0.1:${(server?.address() as { port: number }).port}`;

    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toBe("<html>local shell</html>");

    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("console.log('ok');");
  });

  it("returns false without registering middleware when index.html is missing", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "static-frontend-missing-"));
    const app = express();
    expect(serveFrontend(app, directory)).toBe(false);
  });
});
