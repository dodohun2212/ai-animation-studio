import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NarrationApiError,
  getNarrationReview,
  narrationContentUrl,
  regenerateNarration,
  startNarrationGeneration,
  toNarrationDisplayError,
} from "./narrationApi.js";
import { jsonResponse } from "./testUtils.js";

/**
 * This module had no tests at all, so its safe-message table — the whole mechanism that keeps a backend's raw
 * message off the screen (docs/06_DECISIONS.md D-010) — was unguarded: an entry could be deleted, or a new
 * server code could arrive with none, and nothing would say so. Adding one entry is what surfaced that.
 */
const REVIEW = {
  project: { projectId: "narr", workflowState: "SCRIPT_APPROVED" },
  narrations: [{ sceneNumber: 1, narration: "읽어줄 문장", audio: "none" }],
} as const;

describe("narrationApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the review via GET, generates via POST with explicit approval, and regenerates one scene", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, REVIEW));
    vi.stubGlobal("fetch", fetchMock);

    await getNarrationReview("narr").catch(() => undefined);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/projects/narr/narration/review");

    await startNarrationGeneration("narr").catch(() => undefined);
    const [generateUrl, generateInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(generateUrl).toBe("/projects/narr/narration/generations");
    expect(generateInit.method).toBe("POST");
    // Never an implicit start: the request carries the approval the server requires, so a stray call cannot
    // spend money by omission.
    expect(JSON.parse(String(generateInit.body))).toEqual({ approved: true });

    await regenerateNarration("narr", 1, "더 밝게").catch(() => undefined);
    const [regenerateUrl, regenerateInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(regenerateUrl).toBe("/projects/narr/narration/review/1/regenerate");
    expect(regenerateInit.method).toBe("POST");
    expect(JSON.parse(String(regenerateInit.body))).toEqual({ approved: true, additionalInstruction: "더 밝게" });
  });

  it("gives every server code its own message and never the backend's own words", () => {
    const codes = [
      "INVALID_REQUEST",
      "PROJECT_NOT_FOUND",
      "PROJECT_LOCKED",
      "NARRATION_NOT_ENABLED",
      "NARRATION_MISSING_TEXT",
      "NARRATION_GENERATION_FAILED",
      "NARRATION_STORAGE_ERROR",
      "NARRATION_BUDGET_EXCEEDED",
      "NARRATION_CONTENT_UNAVAILABLE",
    ];

    for (const code of codes) {
      const displayed = toNarrationDisplayError(new NarrationApiError(code, "C:\\\\Users\\\\raw\\\\backend detail"));
      expect(displayed.code).toBe(code);
      // Falling through to the unknown-error text is the failure this guards: the code would still look right
      // while the user reads a sentence that tells them nothing about what happened.
      expect(displayed.code).not.toBe("CLIENT_UNKNOWN_ERROR");
      expect(displayed.message).not.toContain("raw");
      expect(displayed.message.length).toBeGreaterThan(0);
    }
  });

  it("chooses a provider message by category, and falls back rather than echoing the server", () => {
    const rateLimited = toNarrationDisplayError(
      new NarrationApiError("NARRATION_PROVIDER_ERROR", "raw backend detail", { category: "rate_limit" }),
    );
    expect(rateLimited.message).toContain("일시적으로 제한");

    // An unrecognised category must still produce the module's own sentence. The category comes from the server,
    // so treating it as a lookup that always hits would put an undefined message on the screen the first time
    // the backend adds one.
    const unfamiliar = toNarrationDisplayError(
      new NarrationApiError("NARRATION_PROVIDER_ERROR", "raw backend detail", { category: "something_new" }),
    );
    expect(unfamiliar.message).toContain("OpenAI");
    expect(unfamiliar.message).not.toContain("raw backend detail");
  });

  it("keeps a scene's audio URL from being answered out of cache after a regeneration", () => {
    const first = narrationContentUrl("narr", 1, "v1");
    const second = narrationContentUrl("narr", 1, "v2");
    expect(first).not.toBe(second);
    expect(first).toContain("/projects/narr/narration/1/content");
  });
});
