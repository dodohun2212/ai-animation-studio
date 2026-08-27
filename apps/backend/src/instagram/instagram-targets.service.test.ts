import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { InstagramTargetsService } from "./instagram-targets.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const TOKEN = "EAAtest_long_lived_token_value_1234567890";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

/** One page with a connected account, unless overridden. */
function pagesResponse(pages: unknown[] = [{ name: "이배드 스튜디오", instagram_business_account: { id: "178000001", username: "ibad_studio" } }]) {
  return jsonResponse(200, { data: pages });
}

async function setup(options: { connected?: boolean; fetchImpl?: ReturnType<typeof vi.fn> } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instagram-targets-")); roots.push(root);
  const providerSettings = new ProviderSettingsService(new ProviderSettingsRepository(root));
  if (options.connected !== false) await providerSettings.save("instagram", { value: TOKEN });
  const fetchImpl = options.fetchImpl ?? vi.fn().mockResolvedValue(pagesResponse());
  const service = new InstagramTargetsService(root, providerSettings, { fetchImpl, sleep: async () => {} });
  return { root, service, providerSettings, fetchImpl };
}

describe("InstagramTargetsService.list", () => {
  it("reports not-connected, never an empty list, when no token is stored", async () => {
    // "there is no account to publish to" and "you need to sign in" leave the user with different things to do.
    const { service } = await setup({ connected: false });
    await expect(service.list()).rejects.toMatchObject({ response: { code: "INSTAGRAM_NOT_CONNECTED" } });
  });

  it("reports not-connected when Meta rejects the stored token as expired", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "Session has expired", code: 190 } }));
    const { service } = await setup({ fetchImpl });
    await expect(service.list()).rejects.toMatchObject({ response: { code: "INSTAGRAM_NOT_CONNECTED" } });
  });

  it("returns an empty target list, connected, for a professional account with no page linked", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pagesResponse([]));
    const { service } = await setup({ fetchImpl });
    await expect(service.list()).resolves.toEqual({ targets: [] });
  });

  it("omits selectedIgUserId until a choice has been made", async () => {
    const { service } = await setup();
    const result = await service.list();
    expect(result.targets).toHaveLength(1);
    expect(result.selectedIgUserId).toBeUndefined();
  });

  it("remembers a chosen account across a restart", async () => {
    const { service, root, providerSettings, fetchImpl } = await setup();
    await service.select({ igUserId: "178000001" });

    const restarted = new InstagramTargetsService(root, providerSettings, { fetchImpl, sleep: async () => {} });
    await expect(restarted.list()).resolves.toMatchObject({ selectedIgUserId: "178000001" });
  });

  it("drops a remembered account that is no longer among the live targets, rather than echoing it back", async () => {
    // A page can be disconnected, deleted, or have its permission revoked between sessions. Echoing the stored
    // id back unchecked would be the app asserting something it never verified (docs/06_DECISIONS.md D-006).
    const fetchImpl = vi.fn().mockResolvedValue(pagesResponse());
    const { service, root, providerSettings } = await setup({ fetchImpl });
    await service.select({ igUserId: "178000001" });

    const afterRevocation = vi.fn().mockResolvedValue(pagesResponse([
      { name: "다른 페이지", instagram_business_account: { id: "178000099", username: "someone_else" } },
    ]));
    const restarted = new InstagramTargetsService(root, providerSettings, { fetchImpl: afterRevocation, sleep: async () => {} });
    const result = await restarted.list();
    expect(result.targets.map((target) => target.igUserId)).toEqual(["178000099"]);
    expect(result.selectedIgUserId).toBeUndefined(); // the screen must ask again, not publish somewhere else
  });

  it("treats a corrupt selection file as no selection instead of failing the whole listing", async () => {
    const { service, root } = await setup();
    await fs.writeFile(path.join(root, "instagram_target.json"), "{ not json", "utf8");
    await expect(service.list()).resolves.toMatchObject({ targets: [{ igUserId: "178000001" }] });
    expect((await service.list()).selectedIgUserId).toBeUndefined();
  });
});

describe("InstagramTargetsService.select", () => {
  it("stores a valid choice and echoes it back with the live targets", async () => {
    const { service } = await setup();
    await expect(service.select({ igUserId: "178000001" })).resolves.toEqual({
      targets: [{ igUserId: "178000001", username: "ibad_studio", pageName: "이배드 스튜디오" }],
      selectedIgUserId: "178000001",
    });
  });

  it("refuses an account that is not in the live target list", async () => {
    // Validated against a fresh fetch rather than what the client believed was available — a stored id that is
    // not really publishable surfaces later as an unexplained publish failure.
    const { service } = await setup();
    await expect(service.select({ igUserId: "178000999" }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_TARGET_NOT_FOUND" } });
  });

  it("does not persist a refused choice", async () => {
    const { service, root } = await setup();
    await service.select({ igUserId: "178000001" });
    await expect(service.select({ igUserId: "178000999" })).rejects.toMatchObject({ response: { code: "INSTAGRAM_TARGET_NOT_FOUND" } });
    const stored = JSON.parse(await fs.readFile(path.join(root, "instagram_target.json"), "utf8")) as { ig_user_id: string };
    expect(stored.ig_user_id).toBe("178000001");
  });

  it("rejects a malformed request body", async () => {
    const { service } = await setup();
    for (const body of [undefined, {}, { igUserId: "" }, { igUserId: "178000001", extra: true }, "178000001"]) {
      await expect(service.select(body)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
  });

  it("reports not-connected when selecting without a stored token", async () => {
    const { service } = await setup({ connected: false });
    await expect(service.select({ igUserId: "178000001" })).rejects.toMatchObject({ response: { code: "INSTAGRAM_NOT_CONNECTED" } });
  });
});
