import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramLoginService } from "./instagram-login.service.js";
import { instagramCallbackUrl } from "./instagram-oauth.js";
import { InstagramTargetsController } from "./instagram-targets.controller.js";
import type { InstagramPublishService } from "./instagram-publish.service.js";
import type { InstagramTargetsService } from "./instagram-targets.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const REDIRECT = instagramCallbackUrl(3000);

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

/** Answers the two token exchanges the callback performs, in order. */
function exchangeFetch() {
  return vi.fn()
    .mockResolvedValueOnce(jsonResponse(200, { access_token: "short", expires_in: 3600 }))
    .mockResolvedValueOnce(jsonResponse(200, { access_token: "long", expires_in: 5_184_000 }));
}

async function setup(fetchImpl: ReturnType<typeof vi.fn> = exchangeFetch()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instagram-controller-")); roots.push(root);
  const connection = new InstagramConnectionStore(root);
  await connection.saveAppCredentials({ appId: "app-1", appSecret: "secret-1" });
  const login = new InstagramLoginService(connection, REDIRECT, { fetchImpl, sleep: async () => {} });
  const controller = new InstagramTargetsController(
    {} as InstagramTargetsService,
    login,
    {} as InstagramPublishService,
  );
  return { controller, login, connection };
}

/** Starts a login the way the screen does and returns the state the service put in the URL. */
async function startedState(login: InstagramLoginService): Promise<string> {
  const { url } = await login.start();
  return new URL(url).searchParams.get("state")!;
}

describe("InstagramTargetsController login callback", () => {
  it("completes the login Meta redirected back with, and says so on a page", async () => {
    const { controller, login, connection } = await setup();
    const state = await startedState(login);

    const page = await controller.completeLogin({ code: "the-code", state });

    expect(page).toContain("로그인이 완료되었습니다");
    await expect(connection.token()).resolves.toMatchObject({ accessToken: "long" });
  });

  it("answers with a page rather than throwing when the login fails", async () => {
    // Meta sends a person's browser here. A thrown error would render as this app's error envelope, which is
    // neither readable nor something a stranger's browser should be shown.
    const { controller } = await setup();

    const page = await controller.completeLogin({ code: "c", state: "never-issued" });

    expect(page).toContain("완료하지 못했습니다");
  });

  it("never puts the provider's wording, the code, or the state on the page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "raw meta detail", code: 100 } }));
    const { controller, login } = await setup(fetchImpl);
    const state = await startedState(login);

    const page = await controller.completeLogin({ code: "secret-code-value", state });

    expect(page).not.toContain("raw meta detail");
    expect(page).not.toContain("secret-code-value");
    expect(page).not.toContain(state);
  });

  it("escapes rather than reflecting anything from the query into the page", async () => {
    // The query is attacker-reachable — this address is public by construction, since Meta has to be able to
    // reach it. Nothing from it may become markup.
    const { controller } = await setup();

    const page = await controller.completeLogin({ error_description: "<script>alert(1)</script>" });

    expect(page).not.toContain("<script>");
  });

  it("serves a page that loads nothing from anywhere", async () => {
    const { controller, login } = await setup();
    const state = await startedState(login);

    const page = await controller.completeLogin({ code: "the-code", state });

    for (const forbidden of ["<script", "src=", "href=", "http://", "https://"]) {
      expect(page).not.toContain(forbidden);
    }
  });
});
