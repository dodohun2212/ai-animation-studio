import type { ListLongProjectsResponse } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approveLongProjectOutline,
  approveLongEpisodeImageReview,
  createLongProject,
  createLongProjectOutlinePreview,
  getLongProject,
  getLongProjectSettings,
  getLongEpisodeCurrentVideoJob,
  getLongEpisodeImageReview,
  listLongProjects,
  LongProjectsApiError,
  toLongProjectDisplayError,
  updateLongProjectSettings,
  regenerateLongEpisodeImageReview,
  startLongEpisodeImageGeneration,
  getLongEpisodeVideoPreview,
  startLongEpisodeVideoGeneration,
  getLongEpisodeContinuity,
  getLongEpisodeSettings,
  updateLongEpisodeSettings,
  saveLongEpisodeContinuity,
  getLongEpisodeContinuityReference,
  addLongEpisode,
  duplicateLongEpisode,
  archiveLongEpisode,
} from "./longProjectsApi.js";
import { jsonResponse, makeLongEpisodeOutline, makeLongProject, makeLongProjectSettings, makeLongProjectSummary, nonJsonResponse } from "./testUtils.js";

describe("longProjectsApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a long project via POST /long-projects without calling a real network", async () => {
    const project = makeLongProject();
    const settings = makeLongProjectSettings();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createLongProject({ projectId: project.id, settings });

    expect(result).toEqual({ project });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ projectId: project.id, settings });
  });

  it("lists long projects via GET /long-projects", async () => {
    const responseBody: ListLongProjectsResponse = { projects: [makeLongProjectSummary()] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responseBody));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listLongProjects()).toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith("/long-projects");
  });

  it("reopens a long project via GET /long-projects/:projectId", async () => {
    const project = makeLongProject({ id: "reopen_me" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getLongProject("reopen_me")).toEqual({ project });
    expect(fetchMock).toHaveBeenCalledWith("/long-projects/reopen_me");
  });

  it("gets and updates settings via the documented settings route", async () => {
    const settings = makeLongProjectSettings();
    const project = makeLongProject({ settings });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { settings }))
      .mockResolvedValueOnce(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLongProjectSettings("reopen_me")).resolves.toEqual({ settings });
    await expect(updateLongProjectSettings("reopen_me", { settings })).resolves.toEqual({ project });
    expect(fetchMock.mock.calls[0]).toEqual(["/long-projects/reopen_me/settings"]);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/reopen_me/settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ settings });
  });

  it("previews the outline via POST /long-projects/:projectId/outline/preview with no body", async () => {
    const preview = { projectId: "reopen_me", prompt: "outline prompt text", promptSha256: "a".repeat(64), episodeCount: 3 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await createLongProjectOutlinePreview("reopen_me")).toEqual({ preview });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects/reopen_me/outline/preview");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("carries a real budget alongside the outline preview when an OpenAI credential is connected, and rejects a malformed one", async () => {
    const preview = { projectId: "reopen_me", prompt: "outline prompt text", promptSha256: "a".repeat(64), episodeCount: 3 };
    const budget = { monthlyLimitUsd: 10, spentUsd: 0.1, remainingUsd: 9.9, estimatedRequestCostUsd: 0.1, canSpend: true };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { preview, budget })));
    await expect(createLongProjectOutlinePreview("reopen_me")).resolves.toEqual({ preview, budget });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { preview, budget: { ...budget, monthlyLimitUsd: "ten" } })));
    await expect(createLongProjectOutlinePreview("reopen_me")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("approves the outline via POST /long-projects/:projectId/outline/approval with an explicit approved:true body", async () => {
    const project = makeLongProject({ id: "reopen_me", outlineStatus: "outline_ready" });
    const response = { project, approvedAt: "2026-08-23T00:00:00.000Z", promptSha256: "b".repeat(64), modified: true };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    const body = { promptSha256: "a".repeat(64), prompt: "edited outline prompt", approved: true as const };
    expect(await approveLongProjectOutline("reopen_me", body)).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects/reopen_me/outline/approval");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it("uses the local draft Episode timeline routes with an explicit archive body", async () => {
    const project = makeLongProject({ id: "timeline", episodeCount: 2 });
    const episode = makeLongEpisodeOutline({ episodeNumber: 3 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { project, episode }))
      .mockResolvedValueOnce(jsonResponse(200, { project, episode }))
      .mockResolvedValueOnce(jsonResponse(200, { project, archivedEpisodeNumber: 2, archiveId: "archive-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await addLongEpisode("timeline");
    await duplicateLongEpisode("timeline", 2);
    await archiveLongEpisode("timeline", 2);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/long-projects/timeline/episodes",
      "/long-projects/timeline/episodes/2/duplicate",
      "/long-projects/timeline/episodes/2",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({});
    const archive = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(archive.method).toBe("DELETE");
    expect(JSON.parse(String(archive.body))).toEqual({ approved: true });
  });


  it("uses only the documented local Episode image routes and explicit approval bodies", async () => {
    const imageEpisode = { episodeNumber: 1, title: "Episode 1", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "images_review" as const, approved: true, scriptRevision: 3, scriptHistoryCount: 1 };
    const reviews = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending" as const, updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, reviews }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, reviews }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, reviews, sceneNumber: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    await getLongEpisodeImageReview("reopen_me", 1);
    await startLongEpisodeImageGeneration("reopen_me", 1);
    await approveLongEpisodeImageReview("reopen_me", 1, 1);
    await regenerateLongEpisodeImageReview("reopen_me", 1, 2);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/long-projects/reopen_me/episodes/1/images/review",
      "/long-projects/reopen_me/episodes/1/images/generations",
      "/long-projects/reopen_me/episodes/1/images/review/1/approve",
      "/long-projects/reopen_me/episodes/1/images/review/2/regenerate",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ approved: true });
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ approved: true });
  });

  it("gets the read-only Episode Scene 6 continuity reference without a request body", async () => {
    const response = { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6 as const, available: true } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLongEpisodeContinuityReference("reopen_me", 2)).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/long-projects/reopen_me/episodes/2/continuity-reference");
  });

  it("rejects malformed settings responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings: { title: "x" } })));
    await expect(getLongProjectSettings("sample")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a settings response with an out-of-range sceneCount or an unsupported clipDurationSeconds", async () => {
    const valid = makeLongProjectSettings();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings: { ...valid, sceneCount: 99 } })));
    await expect(getLongProjectSettings("sample")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings: { ...valid, clipDurationSeconds: 7 } })));
    await expect(getLongProjectSettings("sample")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  /**
   * Every code long-project-api.error.ts can throw. Kept complete on purpose: an unmapped code falls through
   * to the generic "잠시 후 다시 시도해 주세요", which is wrong twice over for this feature's errors — most are
   * state conflicts that retrying can never clear, and one is a budget stop that must not read as transient.
   */
  const BACKEND_ERROR_CODES = [
    "INVALID_REQUEST",
    "UNSAFE_PROJECT_ID",
    "LONG_PROJECT_NOT_FOUND",
    "LONG_PROJECT_ALREADY_EXISTS",
    "LONG_PROJECT_JSON_MALFORMED",
    "LONG_PROJECT_DATA_INVALID",
    "LONG_PROJECT_STORAGE_ERROR",
    "LONG_PROJECT_ARCHIVE_NOT_ALLOWED",
    "LONG_PROJECT_ARCHIVE_COLLISION",
    "LONG_PROJECT_RESTORE_COLLISION",
    "LONG_OUTLINE_STALE",
    "LONG_OUTLINE_NOT_ALLOWED",
    "LONG_EPISODE_NOT_FOUND",
    "LONG_EPISODE_TIMELINE_NOT_ALLOWED",
    "LONG_EPISODE_LIMIT_REACHED",
    "LONG_EPISODE_SCRIPT_NOT_ALLOWED",
    "LONG_EPISODE_SCRIPT_EXISTS",
    "LONG_EPISODE_MAPPING_NOT_ALLOWED",
    "LONG_EPISODE_MAPPING_NOT_FOUND",
    "LONG_EPISODE_MAPPING_STALE",
    "LONG_EPISODE_MAPPING_UNCONFIRMED",
    "LONG_EPISODE_IMAGES_NOT_ALLOWED",
    "LONG_EPISODE_IMAGES_INVALID",
    "LONG_EPISODE_IMAGES_BUDGET_EXCEEDED",
    "LONG_EPISODE_IMAGES_PROVIDER_ERROR",
    "LONG_EPISODE_VIDEOS_NOT_ALLOWED",
    "LONG_EPISODE_VIDEOS_INVALID",
    "LONG_EPISODE_VIDEO_JOB_NOT_FOUND",
    "LONG_EPISODE_MERGE_NOT_ALLOWED",
    "LONG_EPISODE_MERGE_CLIPS_INVALID",
    "LONG_EPISODE_FFMPEG_UNAVAILABLE",
    "LONG_EPISODE_MERGE_FAILED",
    "LONG_EPISODE_CONTINUITY_NOT_ALLOWED",
    "STORY_BIBLE_ITEM_NOT_FOUND",
    "STORY_BIBLE_ITEM_ALREADY_EXISTS",
    "PROJECT_LOCKED",
  ] as const;

  it("gives every backend error code its own message instead of the generic retry fallback", () => {
    const generic = toLongProjectDisplayError(new Error("unmapped"));
    const fellBack = BACKEND_ERROR_CODES.filter(
      (code) => toLongProjectDisplayError(new LongProjectsApiError(code, "raw")).message === generic.message,
    );
    expect(fellBack).toEqual([]);
  });

  // Same reasoning as the budget stop below, but sharper: here "다시 시도" would be an instruction to make the
  // exact double submission the lock exists to prevent (docs/06_DECISIONS.md D-010).
  it("tells the reader not to press again when another window holds the Episode", () => {
    const displayed = toLongProjectDisplayError(new LongProjectsApiError("PROJECT_LOCKED", "raw"));

    expect(displayed.message).toContain("다시 누르지 마세요");
    expect(displayed.message).not.toContain("다시 시도");
  });

  it("never tells the user to wait and retry a budget stop", () => {
    const displayed = toLongProjectDisplayError(new LongProjectsApiError("LONG_EPISODE_IMAGES_BUDGET_EXCEEDED", "raw"));
    expect(displayed.message).not.toContain("다시 시도");
    expect(displayed.message).toContain("예산");
  });

  describe.each(BACKEND_ERROR_CODES)("Backend error code %s", (code) => {
    it("is preserved verbatim on the thrown LongProjectsApiError", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code, message: `${code} raw backend detail` })));

      await expect(getLongProject("some_id")).rejects.toMatchObject({ code, message: `${code} raw backend detail` });
    });

    it("maps to a fixed, safe message via toLongProjectDisplayError that never leaks the raw backend text", () => {
      const error = new LongProjectsApiError(code, `${code} raw backend detail`);
      const displayed = toLongProjectDisplayError(error);
      expect(displayed.code).toBe(code);
      expect(displayed.message).not.toContain("raw backend detail");
      expect(displayed.message.length).toBeGreaterThan(0);
    });
  });

  it("converts a JSON-parse failure on a success response into a safe LongProjectsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(200)));

    const error = await listLongProjects().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LongProjectsApiError);
    expect((error as LongProjectsApiError).code).toBe("CLIENT_MALFORMED_RESPONSE");
  });

  it("converts fetch() itself throwing (network failure) into a safe LongProjectsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await listLongProjects().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LongProjectsApiError);
    expect((error as LongProjectsApiError).code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("never leaks local paths or raw response bodies into the error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { stack: "at C:\\Users\\secret\\project\\file.ts:42", oops: true })),
    );

    const error = (await listLongProjects().catch((caught: unknown) => caught)) as LongProjectsApiError;
    expect(error.message).not.toContain("C:\\");
    expect(error.message).not.toContain("secret");
  });

  /**
   * The mount-time lookup that leads back to a job already paid for.
   *
   * Its guard demands exactly one key, and nothing tested that: loosening it left all 1063 frontend tests
   * green. What sits behind this response is the recovery button and the review cards, so a shape that slips
   * through would hand the screen a job id it invented rather than one the server named.
   */
  describe("getLongEpisodeCurrentVideoJob", () => {
    it("accepts the two shapes the server actually sends", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { jobId: null })));
      expect(await getLongEpisodeCurrentVideoJob("long", 1)).toEqual({ jobId: null });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { jobId: "job_1" })));
      expect(await getLongEpisodeCurrentVideoJob("long", 1)).toEqual({ jobId: "job_1" });
    });

    it("refuses a response carrying anything else, rather than reading a job id out of it", async () => {
      // A blanket test mock answering every request with a preview body is exactly this case, and it is why
      // several screen tests used to pass for the wrong reason.
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { jobId: "job_1", scenes: [] })));
      await expect(getLongEpisodeCurrentVideoJob("long", 1)).rejects.toThrow();

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { jobId: "" })));
      await expect(getLongEpisodeCurrentVideoJob("long", 1)).rejects.toThrow();

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));
      await expect(getLongEpisodeCurrentVideoJob("long", 1)).rejects.toThrow();
    });
  });

  describe("toLongProjectDisplayError", () => {
    // Both refusals are a project-wide setting blocked by one Episode's existing work. Without the number, a
    // person with twenty Episodes is told they cannot proceed and given nothing to act on. The number lives
    // only in the backend's English message, which never reaches a screen, so it travels in details.
    it("names the Episode responsible for each lock", () => {
      const count = toLongProjectDisplayError(new LongProjectsApiError("LONG_PROJECT_EPISODE_COUNT_LOCKED", "raw backend detail", { episodeNumber: 3 }));
      expect(count.code).toBe("LONG_PROJECT_EPISODE_COUNT_LOCKED");
      expect(count.message).toContain("3회차");
      expect(count.message).not.toContain("raw backend detail");
      // Said in the same breath, because the refusal is only about shrinking and a person who reads "회차 수를
      // 바꿀 수 없습니다" would stop trying to add Episodes too.
      expect(count.message).toContain("늘리는 것은 언제든");

      const ratio = toLongProjectDisplayError(new LongProjectsApiError("LONG_PROJECT_ASPECT_RATIO_LOCKED", "raw backend detail", { episodeNumber: 2 }));
      expect(ratio.code).toBe("LONG_PROJECT_ASPECT_RATIO_LOCKED");
      expect(ratio.message).toContain("2회차");
      expect(ratio.message).toContain("이미지를 다시 만들어야");
      expect(ratio.message).not.toContain("raw backend detail");
    });

    it("falls back to the number-free wording rather than inventing an Episode number", () => {
      // Both halves: the fallback wording is used AND no digit appears. An invented Episode number would send
      // someone to the wrong Episode, which is worse than not naming one.
      for (const details of [undefined, {}, { episodeNumber: "3" }, { episodeNumber: 0 }, { episodeNumber: 1.5 }]) {
        const result = toLongProjectDisplayError(new LongProjectsApiError("LONG_PROJECT_ASPECT_RATIO_LOCKED", "raw", details));
        expect(result.message).toContain("이미지를 다시 만들어야");
        expect(result.message).not.toMatch(/[0-9]회차/);
      }
    });

    it("falls back to a safe generic code/message for an unexpected error", () => {
      const result = toLongProjectDisplayError(new Error("some internal detail"));
      expect(typeof result.code).toBe("string");
      expect(result.code.length).toBeGreaterThan(0);
      expect(result.message).not.toContain("some internal detail");
    });
  });

  it("validates Episode video preview responses and preserves a stale submission API code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { confirmationId: "x", model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene: 5, executionMode: "sequential", estimatedCostUsd: 1.5, scenes: [] })));
    await expect(getLongEpisodeVideoPreview("long", 1)).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "VIDEO_CONFIRMATION_STALE", message: "C:\\\\private" })));
    await expect(startLongEpisodeVideoGeneration("long", 1, { confirmationId: "confirm", userRequestId: "request", approved: true, prompts: [1,2,3,4,5,6].map((sceneNumber) => ({ sceneNumber: sceneNumber as 1|2|3|4|5|6, prompt: "prompt" })) })).rejects.toMatchObject({ code: "VIDEO_CONFIRMATION_STALE" });
  });

  it("reads Episode settings with the project defaults and the changeable flag", async () => {
    const settings = { sceneCount: 8, clipDurationSeconds: 10, episodeDurationSeconds: 80 };
    const projectDefaults = { sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { settings, projectDefaults, changeable: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLongEpisodeSettings("long", 2)).resolves.toEqual({ settings, projectDefaults, changeable: true });
    expect(fetchMock).toHaveBeenCalledWith("/long-projects/long/episodes/2/settings");
  });

  // Both are load-bearing on the screen and neither is recoverable from the rest of the response: without
  // `changeable` the form renders editable for an Episode whose script is already written, and the person finds
  // out from a rejected save — the failure the flag exists to prevent. Without `projectDefaults` the screen
  // cannot mark which values were changed, and silently stopping looks the same as nothing being changed.
  it("rejects an Episode settings response missing changeable or projectDefaults", async () => {
    const settings = { sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings, projectDefaults: settings })));
    await expect(getLongEpisodeSettings("long", 1)).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings, changeable: true })));
    await expect(getLongEpisodeSettings("long", 1)).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });

    // Out of the allowed set rather than merely the wrong type: a clip length of 7 would reach a <select> with
    // no matching <option> and render as nothing chosen, which reads as "not set" instead of as bad data.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      settings: { sceneCount: 6, clipDurationSeconds: 7, episodeDurationSeconds: 42 },
      projectDefaults: settings,
      changeable: true,
    })));
    await expect(getLongEpisodeSettings("long", 1)).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("sends only the two editable fields when saving Episode settings, over PUT", async () => {
    const settings = { sceneCount: 4, clipDurationSeconds: 5, episodeDurationSeconds: 20 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { settings }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateLongEpisodeSettings("long", 3, { sceneCount: 4, clipDurationSeconds: 5 })).resolves.toEqual({ settings });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects/long/episodes/3/settings");
    expect(init.method).toBe("PUT");
    // The server derives episodeDurationSeconds and rejects the request outright if it is sent.
    expect(JSON.parse(String(init.body))).toEqual({ sceneCount: 4, clipDurationSeconds: 5 });
  });

  it("names the settings refusal instead of falling back to the generic unknown error", () => {
    // Reachable despite `changeable`: two windows, a script generated in one, then a save from the other, whose
    // form was drawn before the script existed. Asserted as "not the fallback" as well as "the right code",
    // because an entry that existed but said nothing useful would still pass a code-only check.
    const displayed = toLongProjectDisplayError(new LongProjectsApiError("LONG_EPISODE_SETTINGS_NOT_ALLOWED", "raw backend detail"));
    expect(displayed.code).toBe("LONG_EPISODE_SETTINGS_NOT_ALLOWED");
    expect(displayed.code).not.toBe("CLIENT_UNKNOWN_ERROR");
    expect(displayed.message).toContain("대본을 다시 만들어야");
    expect(displayed.message).not.toContain("raw backend detail");
  });

  it("uses GET and explicit PUT only for Episode continuity memory", async () => {
    const continuity = { episodeNumber: 1, episodeSummary: "summary", events: [], appearedCharacterIds: [], characterChanges: [], appearedLocationIds: [], itemChanges: [], resolvedConflicts: [], newConflicts: [], revealedSecretIds: [], remainingSecretIds: [], newForeshadowingIds: [], resolvedForeshadowingIds: [], nextActions: [], timeElapsed: "", worldChanges: [], userEdits: "", updatedAt: "2026-08-23T00:00:00.000Z" };
    const nextEpisode = { episodeNumber: 2, title: "Episode 2", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "outline_ready" as const, approved: false, scriptRevision: 0, scriptHistoryCount: 0 };
    const { episodeNumber: _episodeNumber, updatedAt: _updatedAt, ...inputMemory } = continuity;
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { memory: null, canSave: true })).mockResolvedValueOnce(jsonResponse(200, { memory: continuity, nextEpisode }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLongEpisodeContinuity("long", 1)).resolves.toEqual({ memory: null, canSave: true });
    await expect(saveLongEpisodeContinuity("long", 1, { memory: inputMemory })).resolves.toEqual({ memory: continuity, nextEpisode });

    expect(fetchMock.mock.calls[0]).toEqual(["/long-projects/long/episodes/1/continuity"]);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long/episodes/1/continuity");
    expect(init.method).toBe("PUT");
  });
});
