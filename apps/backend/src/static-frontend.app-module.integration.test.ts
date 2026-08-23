import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { serveFrontend } from "./static-frontend.js";

let app: INestApplication | undefined;
let frontendDirectory: string | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (frontendDirectory) await fs.rm(frontendDirectory, { recursive: true, force: true });
  frontendDirectory = undefined;
});

describe.sequential("real AppModule with a static frontend bundle attached", () => {
  it("serves the desktop shell's index.html while API routes keep working", async () => {
    frontendDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-shell-"));
    await fs.writeFile(path.join(frontendDirectory, "index.html"), "<html>desktop shell</html>", "utf8");

    app = await NestFactory.create(AppModule, { logger: false });
    serveFrontend(app.getHttpAdapter().getInstance() as Express, frontendDirectory);
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    const shell = await fetch(`${base}/`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toBe("<html>desktop shell</html>");

    const health = await fetch(`${base}/health`);
    expect(await health.json()).toEqual({ status: "ok" });

    const projects = await fetch(`${base}/projects`);
    expect(projects.status).toBe(200);
  });
});
