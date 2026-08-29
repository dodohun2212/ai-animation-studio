import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { InstagramConnectionStore } from "./instagram-connection.store.js";
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

async function setup(options: { connected?: boolean; fetchImpl?: typeof fetch } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instagram-targets-")); roots.push(root);
  const connection = new InstagramConnectionStore(root);
  await connection.saveAppCredentials({ appId: "app-1", appSecret: "secret-1" });
  if (options.connected !== false) await connection.saveToken({ accessToken: TOKEN, expiresAt: null });
  const fetchImpl = options.fetchImpl ?? vi.fn<typeof fetch>().mockResolvedValue(pagesResponse());
  const service = new InstagramTargetsService(root, connection, { fetchImpl, sleep: async () => {} });
  return { root, service, connection, fetchImpl };
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
    const result = await service.list();
    expect(result.targets).toEqual([]);
    expect(result.selectedIgUserId).toBeUndefined();
    // An empty list now carries why it is empty. Named rather than left as "anything else is fine": the point
    // of the exact-shape assertion was that nothing unexpected rides along, and that still holds.
    expect(Object.keys(result).sort()).toEqual(["diagnostics", "targets"]);
  });

  it("omits selectedIgUserId until a choice has been made", async () => {
    const { service } = await setup();
    const result = await service.list();
    expect(result.targets).toHaveLength(1);
    expect(result.selectedIgUserId).toBeUndefined();
  });

  it("remembers a chosen account across a restart", async () => {
    const { service, root, connection, fetchImpl } = await setup();
    await service.select({ igUserId: "178000001" });

    const restarted = new InstagramTargetsService(root, connection, { fetchImpl, sleep: async () => {} });
    await expect(restarted.list()).resolves.toMatchObject({ selectedIgUserId: "178000001" });
  });

  it("drops a remembered account that is no longer among the live targets, rather than echoing it back", async () => {
    // A page can be disconnected, deleted, or have its permission revoked between sessions. Echoing the stored
    // id back unchecked would be the app asserting something it never verified (docs/06_DECISIONS.md D-006).
    const fetchImpl = vi.fn().mockResolvedValue(pagesResponse());
    const { service, root, connection } = await setup({ fetchImpl });
    await service.select({ igUserId: "178000001" });

    const afterRevocation = vi.fn().mockResolvedValue(pagesResponse([
      { name: "다른 페이지", instagram_business_account: { id: "178000099", username: "someone_else" } },
    ]));
    const restarted = new InstagramTargetsService(root, connection, { fetchImpl: afterRevocation, sleep: async () => {} });
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

/**
 * Answers `/me/accounts` and `/me/permissions` separately, so an empty list can be given a cause.
 *
 * `permissions === null` stands for the check itself failing, which must read as "not checked" rather than as
 * "nothing granted" — those two lead a person to different places.
 */
function diagnosticFetch(options: { pages?: unknown[]; permissions?: string[] | null } = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("/me/permissions")) {
      if (options.permissions === null) return jsonResponse(500, { error: { message: "no" } });
      return jsonResponse(200, { data: (options.permissions ?? []).map((permission) => ({ permission, status: "granted" })) });
    }
    if (url.includes("/me/accounts")) return jsonResponse(200, { data: options.pages ?? [] });
    return jsonResponse(200, {});
  });
}

const ALL_SCOPES = ["instagram_basic", "instagram_content_publish", "pages_read_engagement", "pages_show_list"];

describe("InstagramTargetsService.list — why the list is empty", () => {
  it("says nothing at all when there are targets, rather than paying for a diagnosis nobody needs", async () => {
    const { service } = await setup();

    expect((await service.list()).diagnostics).toBeUndefined();
  });

  it("separates no pages from pages without a linked account", async () => {
    // The two have different fixes, and they used to end at the same sentence.
    const none = await setup({ fetchImpl: diagnosticFetch({ pages: [], permissions: ALL_SCOPES }) });
    expect((await none.service.list()).diagnostics).toMatchObject({ pageCount: 0, pagesWithInstagramAccount: 0, missingPermissions: [], permissionsChecked: true });

    const unlinked = await setup({ fetchImpl: diagnosticFetch({ pages: [{ name: "page one" }, { name: "page two" }], permissions: ALL_SCOPES }) });
    expect((await unlinked.service.list()).diagnostics).toMatchObject({ pageCount: 2, pagesWithInstagramAccount: 0, missingPermissions: [] });
  });

  it("names the permissions the token does not hold, which is the cause no amount of fixing Facebook resolves", async () => {
    const { service } = await setup({ fetchImpl: diagnosticFetch({ pages: [], permissions: ["instagram_basic"] }) });

    const { diagnostics } = await service.list();

    expect(diagnostics?.missingPermissions).toEqual(["instagram_content_publish", "pages_read_engagement", "pages_show_list"]);
    expect(diagnostics?.permissionsChecked).toBe(true);
  });

  it("counts a declined permission as missing, never as held", async () => {
    // Meta lists declined permissions in the same array with a different status. Reading them as granted
    // would produce the confident wrong answer this whole diagnosis exists to replace.
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/me/permissions")) {
        return jsonResponse(200, { data: [
          { permission: "instagram_basic", status: "granted" },
          { permission: "pages_show_list", status: "declined" },
        ] });
      }
      return jsonResponse(200, { data: [] });
    });
    const { service } = await setup({ fetchImpl });

    expect((await service.list()).diagnostics?.missingPermissions).toContain("pages_show_list");
  });

  it("reports every permission the token holds, not only the ones this app asks for", async () => {
    // `missingPermissions` is measured against our own four, so a permission we never request cannot appear
    // in it. If the provider needs one we do not ask for, that field reads "nothing missing" while being the
    // entire cause — the confident wrong answer this diagnosis exists to replace.
    const { service } = await setup({ fetchImpl: diagnosticFetch({ pages: [], permissions: [...ALL_SCOPES, "business_management"] }) });

    const { diagnostics } = await service.list();

    expect(diagnostics?.missingPermissions).toEqual([]);
    expect(diagnostics?.grantedPermissions).toContain("business_management");
  });

  it("says the permission check did not happen rather than reporting nothing missing", async () => {
    // "we could not look" and "we looked and all is well" must not be the same answer.
    const { service } = await setup({ fetchImpl: diagnosticFetch({ pages: [], permissions: null }) });

    const { diagnostics } = await service.list();

    expect(diagnostics).toMatchObject({ permissionsChecked: false, missingPermissions: [] });
  });

  it("still answers with an empty list when the counts cannot be read at all", async () => {
    // A diagnosis is a help, not a precondition.
    const fetchImpl = vi.fn<typeof fetch>(async (input) => (
      String(input).includes("/me/accounts") ? jsonResponse(200, { data: [] }) : jsonResponse(500, { error: { message: "no" } })
    ));
    const { service } = await setup({ fetchImpl });

    const result = await service.list();

    expect(result.targets).toEqual([]);
    expect(result.diagnostics).toMatchObject({ permissionsChecked: false });
  });
});

/**
 * The shape a real account produced: `/me/accounts` empty, while the token's own grant names the page and that
 * page answers directly. Every body here is what Meta actually returned, with ids kept and names generic.
 */
function granularFetch(options: { pageIds?: string[]; pageReadable?: boolean } = {}) {
  const pageIds = options.pageIds ?? ["1328208640370353"];
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("/me/accounts")) return jsonResponse(200, { data: [] });
    if (url.includes("/debug_token")) {
      return jsonResponse(200, { data: { granular_scopes: [
        { scope: "pages_show_list", target_ids: pageIds },
        { scope: "instagram_basic", target_ids: ["17841441335872655"] },
      ] } });
    }
    if (url.includes("/me/permissions")) return jsonResponse(200, { data: [{ permission: "pages_show_list", status: "granted" }] });
    if (options.pageReadable === false) return jsonResponse(400, { error: { message: "no", code: 100 } });
    if (url.includes("1328208640370353")) {
      return jsonResponse(200, { id: "1328208640370353", name: "Ibad", instagram_business_account: { id: "17841441335872655", username: "ibad_2012_" } });
    }
    return jsonResponse(200, { id: "other", name: "other page" });
  });
}

describe("InstagramTargetsService.list — a page the listing cannot see", () => {
  it("finds the page the token was granted when /me/accounts answers with nothing", async () => {
    // A real account reached this state: pages_show_list granted for one page, that page and its Instagram
    // account both readable, and the list still empty. Everything was right except the question being asked.
    const { service } = await setup({ fetchImpl: granularFetch() });

    const { targets } = await service.list();

    expect(targets).toEqual([{ igUserId: "17841441335872655", username: "ibad_2012_", pageName: "Ibad" }]);
  });

  it("says nothing to publish to when the grant names no page at all", async () => {
    const { service } = await setup({ fetchImpl: granularFetch({ pageIds: [] }) });

    const result = await service.list();

    expect(result.targets).toEqual([]);
    // And the empty answer still explains itself rather than going silent.
    expect(result.diagnostics).toBeDefined();
  });

  it("keeps the empty list rather than failing when a granted page cannot be read", async () => {
    // A second chance at an answer must not become a new way to fail.
    const { service } = await setup({ fetchImpl: granularFetch({ pageReadable: false }) });

    expect((await service.list()).targets).toEqual([]);
  });

  it("does not go looking for grants when the listing already answered", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => (
      String(input).includes("/me/accounts") ? pagesResponse() : jsonResponse(500, { error: { message: "should not be called" } })
    ));
    const { service } = await setup({ fetchImpl });

    expect((await service.list()).targets).toHaveLength(1);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("debug_token"))).toBe(false);
  });
});
