import { RUNWAY_CLIP_DURATIONS } from "@ai-animation-studio/shared";
import { LONG_EPISODE_STATUSES } from "@ai-animation-studio/shared";
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
  episodeSceneErrorMessage,
} from "./longProjectsApi.js";
import { sceneErrorMessage } from "./videoWorkflowApi.js";
import { episodeImageStaleness, jsonResponse, makeLongEpisodeOutline, makeLongProject, makeLongProjectSettings, makeLongProjectSummary, nonJsonResponse } from "./testUtils.js";

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

  /**
   * The status guard has to accept everything the contract allows, and it used to be a hand-written set of all
   * eighteen. A status added to the contract and not to that copy would make this client call a perfectly good
   * Episode malformed — the screen saying 서버 응답을 확인할 수 없습니다 about a server that is working.
   *
   * It is built from LONG_EPISODE_STATUSES now, and this is what says so: every status the contract names must
   * come back through the client unchanged.
   */
  it("accepts an Episode in every status the contract allows", async () => {
    for (const status of LONG_EPISODE_STATUSES) {
      const project = makeLongProject({ id: "all_states", episodes: [makeLongEpisodeOutline({ status })] });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
      await expect(getLongProject("all_states"), status).resolves.toEqual({ project });
    }
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
      // `aspectRatioChangeable` is required by the contract, so a stub without it is malformed — the guard
      // doing its job, not a test to loosen.
      .mockResolvedValueOnce(jsonResponse(200, { settings, aspectRatioChangeable: true }))
      .mockResolvedValueOnce(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLongProjectSettings("reopen_me")).resolves.toEqual({ settings, aspectRatioChangeable: true });
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
      // `staleness` and `storyBibleLinkDrift` are both required on all three review-shaped responses, so a stub
      // missing either is malformed — which is the guard doing its job, not a test to loosen.
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, reviews, staleness: episodeImageStaleness(), storyBibleLinkDrift: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, reviews, staleness: episodeImageStaleness(), storyBibleLinkDrift: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, reviews, staleness: episodeImageStaleness(), storyBibleLinkDrift: [], sceneNumber: 2 }));
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

  /**
   * A guard that skips a required list still tells the compiler the whole type arrived, so the field it does not
   * look at reaches the screen typed as an array and valued as undefined — and the screen narrows these lists
   * with .filter after a regeneration. This is what the missing check actually costs, so it is checked.
   */
  it("rejects an image review whose staleness is missing a list the contract requires", async () => {
    const imageEpisode = { episodeNumber: 1, title: "Episode 1", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "images_review" as const, approved: true, scriptRevision: 3, scriptHistoryCount: 1 };
    const reviews = [{ sceneNumber: 1, status: "pending" as const, updatedAt: "2026-09-05T00:00:00.000Z" }];
    const body = { episode: imageEpisode, reviews, staleness: episodeImageStaleness(), storyBibleLinkDrift: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));
    await expect(getLongEpisodeImageReview("sample", 1)).resolves.toMatchObject({ staleness: { styleStale: [] } });

    const { styleStale: _dropped, ...withoutStyle } = body.staleness;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ...body, staleness: withoutStyle })));
    await expect(getLongEpisodeImageReview("sample", 1)).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
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
    "LONG_EPISODE_MERGE_BUSY",
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
    /*
     * 🔴 The Episode half of ②-2, and the reason it has its own case rather than trusting the short project's.
     *
     * `imageFailureMessage` is shared and has its own tests, but a shared function is only as good as the line
     * that calls it: removing the call from the short project's mapper left all 487 of its tests green
     * (imageGenerationApi.test.ts says so). The same hole exists once per pipeline, so it is closed once per
     * pipeline.
     */
    it("says which scene an Episode's image run stopped at, alongside what the provider said", () => {
      const displayed = toLongProjectDisplayError(
        new LongProjectsApiError("LONG_EPISODE_IMAGES_PROVIDER_ERROR", "raw backend detail", {
          category: "safety_policy",
          sceneNumber: 4,
          scope: "run",
          billedOnFailure: true,
          remedy: "change_input",
        }),
      );

      expect(displayed.code).toBe("LONG_EPISODE_IMAGES_PROVIDER_ERROR");
      expect(displayed.message).toContain("4번 장면에서 멈췄습니다");
      expect(displayed.message).toContain("예산에는 쓴 것으로 계상");
      expect(displayed.message).not.toContain("raw backend detail");
      // 🔴 The scene number is the scene, never the Episode number — the two are both small integers on this
      // screen and a mapper that reached for the wrong one would look right in every screenshot.
      expect(displayed.message).not.toContain("1번 장면에서");
    });

    /*
     * 🔴 The Episode's redraw, under the same error code as its batch run — the case CLI caught on the screen.
     * `LongEpisodeImageGenerationScreen`'s 다시 만들기 goes through this very mapper, and promising a resume
     * there would be a sentence about scenes 6+ that were never touched.
     */
    it("does not promise a resume when one Episode scene's redraw failed", () => {
      const displayed = toLongProjectDisplayError(
        new LongProjectsApiError("LONG_EPISODE_IMAGES_PROVIDER_ERROR", "raw", {
          category: "safety_policy",
          sceneNumber: 5,
          scope: "scene",
          billedOnFailure: true,
        }),
      );

      expect(displayed.message).toContain("5번 장면을 다시 그리지 못했습니다");
      expect(displayed.message).not.toContain("이어서");
    });

    // A response from a build that predates the details must read exactly as it did before: no scene, no budget.
    it("keeps the old Episode image sentence when the failure carries no details", () => {
      const displayed = toLongProjectDisplayError(
        new LongProjectsApiError("LONG_EPISODE_IMAGES_PROVIDER_ERROR", "raw", { category: "safety_policy" }),
      );

      expect(displayed.message).not.toContain("장면에서 멈췄습니다");
      expect(displayed.message).not.toContain("예산");
      expect(displayed.message).not.toContain("raw");
    });

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

  /**
   * This guard spelled out `=== 5 || === 10` beside a model check that had already been widened for exactly
   * this reason. The values were right, and that is the danger: the short project's twin of the line said
   * `=== 5`, called a correct server response malformed, and cost 캡틴D the entire video step this morning.
   *
   * Both allowed lengths are asserted rather than only the second, because a guard rewritten to accept just ten
   * would pass a test that only tried ten.
   */
  it("accepts every clip length the contract allows, and still rejects one it does not", async () => {
    const preview = (durationSecondsPerScene: number) => ({
      confirmationId: "x", model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene,
      executionMode: "sequential", estimatedCostUsd: 1.5, scenes: [1, 2].map((sceneNumber) => ({ sceneNumber, prompt: "p", estimatedCostUsd: 0.25, omittedSections: [] })),
    });

    for (const seconds of RUNWAY_CLIP_DURATIONS) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, preview(seconds))));
      const response = await getLongEpisodeVideoPreview("long", 1);
      expect(response.durationSecondsPerScene).toBe(seconds);
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, preview(7))));
    await expect(getLongEpisodeVideoPreview("long", 1)).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
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

  /**
   * 장편의 Runway 장면 오류 표는 짧은 쪽(`videoWorkflowApi.ts`)의 「똑같은 독립 사본」이라고
   * 주석에 적혀 있었지만, 사본은 달라져 있었습니다 — `quota_or_permission` 과 `submit_interrupted` 가
   * 여기에만 없었습니다. 「똑같다」는 주석은 달라졌을 때 아무 말도 하지 않으므로, 이 짝이
   * 대신 말합니다: 한 쪽에만 칸을 넣거나 문장을 한 글자 고쳐도 빨간집니다.
   *
   * 목록은 백엔드의 닫힌 분류 + 우리가 만든 코드입니다(`RunwayErrorCategory` ·
   * `runway-workflow-support.ts` · 예산 거절 둘). CLI 가 이 합집합을 shared 로 내보내주면
   * 손 타이핑을 버리고 계약을 읽게 바꾸겠습니다.
   */
  describe("Runway scene-error sentences", () => {
    const SCENE_ERROR_CODES = [
      "authentication",
      "permission",
      "quota_or_permission",
      "rate_limit",
      "invalid_request",
      "server",
      "network",
      "timeout",
      "no_output",
      "invalid_state",
      "budget_exceeded",
      "budget_ledger_unreadable",
      "submit_interrupted",
    ];

    it("says the same thing on an Episode as on a short project, for every known code", () => {
      // fallback 은 단어로 적지 않고 모듈에게 직접 물어봅니다 — 문장을 다듬으면 짝이 조용히 느슬해지는 걸 막습니다.
      const episodeFallback = episodeSceneErrorMessage("not_a_real_code");
      const shortFallback = sceneErrorMessage("not_a_real_code");
      expect(episodeFallback).toBe(shortFallback);

      for (const code of SCENE_ERROR_CODES) {
        expect(episodeSceneErrorMessage(code), code).not.toBe(episodeFallback);
        expect(episodeSceneErrorMessage(code), code).toBe(sceneErrorMessage(code));
      }
    });

    /**
     * 돈 쪽 이유로 따로 둠니다. `submit_interrupted` 는 「이미 접수됐을 수 있으니 계정에서
     * 확인하라」만 하라고 있는 칸이고, 빠졌을 때 폴백이 말하는 「잠시 후 다시 시도」는
     * 한 장면을 두 번 결제하게 만드는 바로 그 문장입니다(2026-09-05).
     */
    it("never tells someone to just retry a scene whose submission may already be in flight", () => {
      for (const message of [episodeSceneErrorMessage("submit_interrupted"), sceneErrorMessage("submit_interrupted")]) {
        expect(message).not.toBe(episodeSceneErrorMessage("not_a_real_code"));
        expect(message).toContain("자동으로 다시 보내지 않았습니다");
      }
    });

    it("tells an Episode that Runway credits ran out, instead of the generic failure sentence", () => {
      const message = episodeSceneErrorMessage("quota_or_permission");
      expect(message).not.toBe(episodeSceneErrorMessage("not_a_real_code"));
      expect(message).toContain("크레딧");
    });
  });

  /**
   * `LONG_EPISODE_NARRATION_PROVIDER_MESSAGES` 도 narrationApi 와 같은 죽은 키(`server_error`)를 가지고
   * 있었습니다 — 「같다」는 주석이 버그까지 같게 만들어 둔 경우입니다.
   */
  describe("Episode narration provider sentences", () => {
    const OPENAI_CATEGORIES = [
      "authentication",
      "quota_or_permission",
      "rate_limit",
      "server",
      "network",
      "invalid_request",
      "safety_policy",
      "context_length_exceeded",
    ];

    const displayed = (category: string, rest: Record<string, unknown> = {}) =>
      toLongProjectDisplayError(
        new LongProjectsApiError("LONG_EPISODE_NARRATION_PROVIDER_ERROR", "raw backend detail", { category, ...rest }),
      ).message;

    it("has its own sentence for every category the backend can actually send", () => {
      const fallback = displayed("not_a_real_category");
      for (const category of OPENAI_CATEGORIES) {
        expect(displayed(category), category).not.toBe(fallback);
        expect(displayed(category), category).not.toContain("raw");
      }
    });

    /**
     * 🔴 759 — 같은 함수를 쓰는 두 파이프라인은 **연결 짝이 각각** 필요합니다. 단기 쪽 짝이 초록이어도
     * 이 모듈에서 호출을 빼면 에피소드 화면만 조용히 옛 문장으로 돌아갑니다. 그래서 같은 사실을 여기서
     * 다시 묻습니다 — 중복이 아니라, 묻는 대상이 다릅니다.
     */
    it("says where the Episode's narration run stopped, through the shared composer", () => {
      const message = displayed("server", { sceneNumber: 7, scope: "run", billedOnFailure: true });

      expect(message).toContain("7번 장면에서 멈췄습니다");
      expect(message).toContain("음성은 저장돼 있어");
      expect(message).toContain("7번부터 이어서");
      expect(message).toContain("OpenAI 서버 오류");
      expect(message).toContain("예산에는 쓴 것으로");
      expect(message).not.toContain("raw backend detail");
    });

    /** 763→765 가 이미지에서 고친 거짓말 — 에피소드는 일괄과 한 장면 재생성이 같은 코드라 여기서 제일 위험합니다. */
    it("never promises a resume when one Episode scene's narration redo failed", () => {
      const message = displayed("server", { sceneNumber: 5, scope: "scene", billedOnFailure: true });

      expect(message).toContain("5번 장면 음성을 다시 만들지 못했습니다");
      expect(message).not.toContain("이어서");
    });

    /** 칸이 없던 시절의 응답은 정확히 예전처럼 읽혀야 합니다 — 없는 장면 번호를 지어내지 않습니다. */
    it("reads exactly as before when the response carries no scene detail", () => {
      const message = displayed("server", {});

      expect(message).toContain("OpenAI 서버 오류");
      expect(message).not.toContain("장면");
      expect(message).not.toContain("예산");
    });

    it("never tells someone to retry a narration failure that retrying cannot fix", () => {
      for (const category of ["quota_or_permission", "safety_policy", "authentication"]) {
        expect(displayed(category), category).not.toContain("잠시 후 다시 시도");
      }
    });
  });
});
