import { Controller, Get, HttpStatus, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";

import { projectNotFound } from "./projects/project-api.error.js";
import { INTERNAL_ERROR_CODE, UnexpectedErrorFilter } from "./unexpected-error.filter.js";

@Controller("filter-probe")
class ProbeController {
  @Get("throws")
  throws(): never { throw new Error("a stack trace and a file path live in here"); }

  @Get("refuses")
  refuses(): never { throw projectNotFound("probe_project"); }

  @Get("missing-route-shape")
  ok(): { ok: true } { return { ok: true }; }
}

@Module({ controllers: [ProbeController], providers: [{ provide: APP_FILTER, useClass: UnexpectedErrorFilter }] })
class ProbeModule {}

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function probe(routePath: string): Promise<{ status: number; body: unknown }> {
  const app = await NestFactory.create(ProbeModule, { logger: false });
  close = () => app.close();
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  const response = await fetch(`${url}/filter-probe/${routePath}`);
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

/**
 * What this server answers when a route fails in a way nobody wrote a sentence for.
 *
 * Every deliberate refusal here is an HttpException carrying `{ code, message }`, and every client guard reads
 * that shape. Nothing shaped the rest: an unexpected throw answered with Nest's default `{ statusCode,
 * message }`, which has no `code` at all, so a client could not tell a server that failed from a server that
 * was not there.
 *
 * That stopped being theoretical on 2026-09-06. A thirteen-minute outage put two different sentences on screen
 * at once, because two client modules read "5xx that is not our shape" as *the server is not running* while
 * sixteen called it a malformed response — and for a real crash both readings are wrong.
 */
describe("an unexpected failure still answers in this app's shape", () => {
  it("gives a crash a code, so nothing has to guess the server is off", async () => {
    const { status, body } = await probe("throws");
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body).toEqual({ code: INTERNAL_ERROR_CODE, message: expect.any(String) });
  });

  it("says nothing about the cause in the response body", async () => {
    // The thrown text is logged, never sent. A stack trace or a file path in a response body is a leak, and a
    // sentence guessed from an unknown failure is worse than the plain one.
    const { body } = await probe("throws");
    expect(JSON.stringify(body)).not.toContain("stack trace");
    expect(JSON.stringify(body)).not.toContain("file path");
  });

  it("leaves a deliberate refusal exactly as it was", async () => {
    // These are the answers this app means. Re-shaping them here would move behaviour that every other test in
    // this repository already pins.
    const { status, body } = await probe("refuses");
    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body).toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("leaves Nest's own refusals alone too", async () => {
    // A route that does not exist is Nest's 404, not this app's — passing it through unchanged is what keeps
    // "this route is not here" distinguishable from "this project is not here".
    const { status, body } = await probe("no-such-route");
    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body).toMatchObject({ statusCode: 404 });
  });
});
