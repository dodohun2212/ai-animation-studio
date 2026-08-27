import { afterEach, describe, expect, it, vi } from "vitest";

import { getInstagramTargets, setInstagramTarget, targetLabel, toInstagramTargetsDisplayError } from "./instagramTargetsApi.js";
import { jsonResponse } from "./testUtils.js";

function target(overrides: Record<string, unknown> = {}) {
  return { igUserId: "17841400000000000", username: "ibad_studio", pageName: "이배드", ...overrides };
}

describe("instagramTargetsApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads targets via GET /settings/instagram/targets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { targets: [target()], selectedIgUserId: "17841400000000000" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getInstagramTargets();

    expect(fetchMock).toHaveBeenCalledWith("/settings/instagram/targets", undefined);
    expect(response.selectedIgUserId).toBe("17841400000000000");
  });

  // Absent is the meaningful "the stored choice is gone, ask again" state — not a malformed response.
  it("accepts a response with no selection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { targets: [target()] })));
    // Asserted field by field rather than with toMatchObject: an explicitly-undefined property there requires
    // the key to be present, which is the opposite of the absence this state is defined by.
    const response = await getInstagramTargets();
    expect(response.targets).toHaveLength(1);
    expect(response.selectedIgUserId).toBeUndefined();
  });

  it("rejects a target whose fields are the wrong type", async () => {
    for (const bad of [{ igUserId: 5 }, { username: "" }, { pageName: null }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { targets: [target(bad)] })));
      await expect(getInstagramTargets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
    }
  });

  it("saves the pick via PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { targets: [target()], selectedIgUserId: "17841400000000000" }));
    vi.stubGlobal("fetch", fetchMock);

    await setInstagramTarget("17841400000000000");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/instagram/target");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ igUserId: "17841400000000000" });
  });

  // "Log in" and "connect a Page" are different things to go do, so they must not share a message.
  it("maps each backend code to its own fixed message and never leaks the raw one", async () => {
    for (const [code, expected] of [["INSTAGRAM_NOT_CONNECTED", "로그인"], ["INSTAGRAM_TARGET_NOT_FOUND", "다시 골라"]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code, message: "raw backend detail" })));
      const caught = await getInstagramTargets().catch((error: unknown) => error);
      const display = toInstagramTargetsDisplayError(caught);
      expect(display.code).toBe(code);
      expect(display.message).toContain(expected);
      expect(display.message).not.toContain("raw backend detail");
    }
  });

  it("reports a network failure as its own code rather than as a server answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const caught = await getInstagramTargets().catch((error: unknown) => error);
    expect(toInstagramTargetsDisplayError(caught).code).toBe("CLIENT_NETWORK_ERROR");
  });
});

describe("targetLabel", () => {
  it("names an account by its handle", () => {
    expect(targetLabel(target())).toEqual({ name: "@ibad_studio", handleUnavailable: false });
  });

  // The backend puts the numeric id in `username` rather than dropping an account it could not name. That is the
  // right trade — but a bare number must never stand as the account name in a publish confirmation, so the Page
  // name takes over and the screen is told the handle is missing.
  it("falls back to the Page name when the handle came back as a bare id", () => {
    expect(targetLabel(target({ username: "17841400000000000" }))).toEqual({ name: "이배드", handleUnavailable: true });
  });

  it("still produces something identifiable when the Page name is empty too", () => {
    const label = targetLabel(target({ username: "17841400000000000", pageName: "   " }));
    expect(label.handleUnavailable).toBe(true);
    expect(label.name).toContain("17841400000000000");
  });
});
