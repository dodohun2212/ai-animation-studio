import type { LongEpisodeStatus, LongEpisodeDetail, LongEpisodeVideoProgress } from "@ai-animation-studio/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, sequence, stubFetchByRoute, withStatus } from "../api/testUtils.js";
import { LongEpisodeVideoWorkflowScreen } from "./LongEpisodeVideoWorkflowScreen.js";

const episode = (status: LongEpisodeStatus): LongEpisodeDetail => ({ episodeNumber: 1, title: "Episode", summary: "s", mainEvent: "e", conflict: "c", cliffhanger: "h", nextEpisodeHook: "n", status, approved: true, scriptRevision: 1, scriptHistoryCount: 1, updatedAt: "2026-09-05T00:00:00.000Z" });
const preview = { confirmationId: "confirm", model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene: 5, executionMode: "sequential", estimatedCostUsd: 1.5, scenes: [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, prompt: `prompt ${sceneNumber}`, estimatedCostUsd: .25 })) };
// paidProvider is required and stated, never inferred: a run whose cost line is missing is not a free run. The
// fixture said nothing, which is exactly the shape the client now refuses.
const progress = (status: "created" | "running" | "succeeded" | "interrupted", completed: number[] = []): LongEpisodeVideoProgress => ({ paidProvider: false, jobId: "job", status, completedSceneNumbers: completed, failedSceneNumbers: [], sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode(status === "succeeded" ? "videos_review" : "videos_generating") });
/**
 * Assertions here name the request they mean instead of counting to it.
 *
 * Counting every call is only right until the screen makes one more, and this screen just gained a
 * current-job lookup on mount — which turned "no generation was requested" into a failure about the number 2.
 * Same helpers the outline and settings screens already use, for the same reason.
 */
function countTo(fetchMock: ReturnType<typeof vi.fn>, suffix: string): number {
  return (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).filter(([url]) => String(url).endsWith(suffix)).length;
}
/** Every call to `suffix`, in order — so "the first submission" and "the second" survive a new request elsewhere. */
function callsTo(fetchMock: ReturnType<typeof vi.fn>, suffix: string): [string, RequestInit][] {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url]) => String(url).endsWith(suffix));
}
function callTo(fetchMock: ReturnType<typeof vi.fn>, suffix: string): [string, RequestInit] {
  const call = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(([url]) => String(url).endsWith(suffix));
  if (!call) throw new Error(`No request was made to ${suffix}`);
  return call;
}

/**
 * The review cards ask each scene for its past clips. One entry per scene, all saying "nothing archived", so
 * these tests stay about recovery and playback rather than about history.
 */
const sceneVersionRoutes = () => Object.fromEntries([1, 2, 3, 4, 5, 6].map((sceneNumber) => [
  `GET /videos/${sceneNumber}/versions`,
  { versions: [{ versionId: "current", createdAt: "2026-08-23T00:00:00.000Z", bytes: 2048, isCurrent: true }] },
]));

describe("LongEpisodeVideoWorkflowScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * The screen had been storing the server's answer since the start response and never reading it, showing a
   * sentence that names both cases instead. Before a run exists that is honest — nothing has been started. Once
   * one exists it makes the person work out which case applies to money they have already spent.
   */
  /**
   * The short project's preview has named the sections it had to cut since it shipped; the Episode threw the
   * server's list away. A scene could lose its pacing or performance direction and the only way to find out was
   * a finished clip that was wrong — after paying for it. And the Episode is the side that hits the limit first:
   * its real prompts run 493-902 characters against a 1,000 limit, the short project's 599-732.
   */
  it("names the sections the server had to cut, and says nothing about a scene that lost none", async () => {
    const trimmed = {
      ...preview,
      scenes: preview.scenes.map((scene: { sceneNumber: number }) =>
        scene.sceneNumber === 2 ? { ...scene, omittedSections: ["Pacing"] } : scene),
    };
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /videos/generations/current": { jobId: null }, "GET /videos/preview": trimmed }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const line = await screen.findByTestId("episode-video-omitted-2");
    expect(line.textContent, "the server's own vocabulary is not what the person reads").toContain("움직임 속도");
    expect(line.textContent).toContain("길이 제한");
    expect(screen.queryByTestId("episode-video-omitted-1"), "a scene that lost nothing says nothing").toBeNull();
  });

  it("says whether the run in progress is paid, instead of naming both cases", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": { ...progress("running", [1]), paidProvider: true },
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const notice = await screen.findByTestId("episode-video-provider-notice");
    await waitFor(() => expect(notice.textContent).toContain("실제 유료 Runway API를 호출합니다"));
    expect(notice.textContent, "the run's own answer replaces the two-branch sentence").not.toContain("연결되어 있으면");
  });

  it("shows the remaining monthly budget and call cap before approval, warning when the estimate exceeds it", async () => {
    const withBudget = {
      ...preview,
      maximumProviderCalls: 6,
      budget: { monthlyLimitUsd: 10, spentUsd: 9.6, remainingUsd: 0.4, estimatedRequestCostUsd: 1.5, canSpend: false },
    };
    // Named routes, not one blanket answer: a blanket mock replies to the mount's current-job lookup with a
    // 미리보기 body, which only works because the response guard happens to reject it.
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /videos/generations/current": { jobId: null }, "GET /videos/preview": withBudget }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-summary");
    expect(screen.getByTestId("episode-video-max-calls").textContent).toContain("6회");
    const budgetLine = screen.getByTestId("episode-video-budget").textContent ?? "";
    expect(budgetLine).toContain("$0.40");
    expect(budgetLine).toContain("$9.60");
    expect(screen.getByTestId("episode-video-budget-exceeded")).toBeTruthy();
  });

  it("states model, ratio and clip length before the paid button, the way the short project does", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /videos/generations/current": { jobId: null }, "GET /videos/preview": preview }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const spec = await screen.findByTestId("episode-video-output-spec");
    expect(spec.textContent).toContain("gen4_turbo");
    expect(spec.textContent).toContain("세로형 9:16");
    expect(spec.textContent).toContain("5초");
  });

  it("shows a landscape Episode as landscape rather than always claiming vertical", async () => {
    // The orientation comes from the response, so a project set to 16:9 reads as 16:9 here — this line is the
    // only place a wrong output shape is visible before six clips are paid for.
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /videos/generations/current": { jobId: null }, "GET /videos/preview": { ...preview, ratio: "1280:720" } }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    expect((await screen.findByTestId("episode-video-output-spec")).textContent).toContain("가로형 16:9");
  });

  it("omits the budget block entirely when no Runway credential is connected", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /videos/generations/current": { jobId: null }, "GET /videos/preview": preview }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-summary");
    expect(screen.queryByTestId("episode-video-budget")).toBeNull();
    expect(screen.queryByTestId("episode-video-max-calls")).toBeNull();
    expect(screen.queryByTestId("episode-video-budget-exceeded")).toBeNull();
  });

  it("does not submit until final local confirmation and sends the exact explicit request", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: null },
      "GET /videos/preview": preview,
      "POST /videos/generations": { paidProvider: false, jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);
    await screen.findByTestId("episode-video-summary"); fireEvent.click(screen.getByTestId("episode-video-open-confirm")); expect(countTo(fetchMock, "/videos/generations")).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" })); await screen.findByTestId("episode-video-progress");
    expect(callTo(fetchMock, "/videos/generations")[0]).toBe("/long-projects/long/episodes/1/videos/generations"); const body = JSON.parse(String(callTo(fetchMock, "/videos/generations")[1].body)); expect(body).toMatchObject({ confirmationId: "confirm", approved: true, prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); expect(typeof body.userRequestId).toBe("string");
  });
  it("renders persisted sequential progress, stop/restart, and review approval/regeneration confirmations", async () => {
    const review = [1,2,3,4,5,6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: null },
      "GET /videos/preview": preview,
      "POST /videos/generations": { paidProvider: false, jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") },
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
      "POST /videos/generations/job/review/1/approve": { episode: episode("videos_review"), reviews: [{ ...review[0], status: "approved" }, ...review.slice(1)], staleness: { videoStale: [] } },
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />); await screen.findByTestId("episode-video-summary");
    fireEvent.click(screen.getByTestId("episode-video-open-confirm")); fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" })); await screen.findByTestId("episode-video-progress");
    // Simulate a persisted completed job by invoking the same progress endpoint through the polling effect.
    // Wait for the thing this asserts about — the review cards — not for a number of requests. The count was
    // four until the screen gained a current-job lookup, and it would move again the next time anything else asks.
    await screen.findAllByRole("button", { name: "이 영상으로 확정" }); fireEvent.click(screen.getAllByRole("button", { name: "이 영상으로 확정" })[0]!); await waitFor(() => expect(countTo(fetchMock, "/review/1/approve")).toBe(1)); expect(callTo(fetchMock, "/review/1/approve")[0]).toBe("/long-projects/long/episodes/1/videos/generations/job/review/1/approve");
    fireEvent.click(screen.getAllByRole("button", { name: "다시 만들기" })[1]!); expect(await screen.findByTestId("episode-video-regenerate-confirm-2")).toBeTruthy();
  });
  it("offers a retry for a scene Runway reported failed, only submitting after explicit confirmation, and shows an actionable reason", async () => {
    const failedJob = {
      paidProvider: false, jobId: "job", status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2, 3], sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating"),
      sceneErrors: { 2: "authentication", 3: "Runway rejected the prompt: explicit content detected" },
    };
    const retriedJob = { jobId: "job", status: "running", completedSceneNumbers: [1], currentSceneNumber: 2, failedSceneNumbers: [], sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") };
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: null },
      "GET /videos/preview": preview,
      "POST /videos/generations": { paidProvider: false, jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") },
      "GET /videos/generations/job": failedJob,
      "POST /videos/generations/job/scenes/2/regenerate": retriedJob,
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);
    await screen.findByTestId("episode-video-summary");
    fireEvent.click(screen.getByTestId("episode-video-open-confirm")); fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" }));
    await screen.findByTestId("episode-video-failed-scenes");
    expect(screen.getByTestId("episode-video-failed-reason-2").textContent).toContain("Runway API 키 인증에 실패했습니다");
    // An unrecognized code — including Runway's own raw failure text — must never be shown verbatim.
    const opaqueReason = screen.getByTestId("episode-video-failed-reason-3");
    expect(opaqueReason.textContent).not.toContain("Runway rejected the prompt");
    expect(opaqueReason.textContent).toContain("영상 생성에 실패했습니다");
    fireEvent.click(screen.getByTestId("episode-video-failed-retry-2"));
    const panel = await screen.findByTestId("episode-video-failed-retry-confirm-2");
    fireEvent.click(within(panel).getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(countTo(fetchMock, "/scenes/2/regenerate")).toBe(1));
    expect(callTo(fetchMock, "/scenes/2/regenerate")[0]).toBe("/long-projects/long/episodes/1/videos/generations/job/scenes/2/regenerate");
  });

  /**
   * 🔴 The retry that could not change anything.
   *
   * `additionalInstruction` is on the request, the API function takes it, and the service appends it to the
   * scene's prompt — and this path sent none, so pressing 다시 시도 re-sent a byte-identical request. Episode
   * 5 scene 3 failed twice that way at $0.25 each (`INTERNAL.BAD_OUTPUT.CODE01`): the prompt asked for a face
   * to disintegrate while its own fixed suffix asks for anatomy to stay stable, and retrying a contradiction
   * resolves nothing. The review-stage regeneration below has carried this field all along.
   */
  it("sends the typed direction with a failed scene's retry", async () => {
    const failedJob = {
      paidProvider: true, jobId: "job", status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2],
      sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating"),
      sceneErrors: { 2: "An unexpected error occurred. (Runway code: INTERNAL.BAD_OUTPUT.CODE01)" },
    };
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": failedJob,
      "POST /videos/generations/job/scenes/2/regenerate": { jobId: "job", status: "running", completedSceneNumbers: [1], failedSceneNumbers: [], sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-failed-scenes");
    fireEvent.click(screen.getByTestId("episode-video-failed-retry-2"));
    fireEvent.change(await screen.findByTestId("episode-video-failed-retry-instruction-2"), { target: { value: "얼굴은 온전하게 유지한다" } });
    fireEvent.click(within(await screen.findByTestId("episode-video-failed-retry-confirm-2")).getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(countTo(fetchMock, "/scenes/2/regenerate")).toBe(1));
    const body = JSON.parse(String((callTo(fetchMock, "/scenes/2/regenerate")[1] as RequestInit).body));
    expect(body.additionalInstruction).toBe("얼굴은 온전하게 유지한다");
  });

  it("handles stale API errors without exposing internal paths", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "VIDEO_CONFIRMATION_STALE", message: "raw C:\\\\private" }))); render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />); const alert = await screen.findByRole("alert"); expect(alert).toHaveAttribute("data-error-code", "CLIENT_UNKNOWN_ERROR"); expect(document.body.textContent).not.toContain("C:\\private"); });

  it("says up front that a connected Runway key means real paid requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, preview)));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const notice = await screen.findByTestId("episode-video-provider-notice");
    expect(notice.textContent).toContain("실제 유료 요청이 전송됩니다");
    expect(notice.textContent).not.toContain("보내지 않습니다");
  });

  // The id identifies the intent, not the click. A retry after a failed send has to carry the same one, or the
  // server sees two separate requests and the field is decorative — which is exactly what it was, because it
  // was minted inside the send.
  it("reuses one request id across a retry, and only mints a new one for a new intent", async () => {
    const fetchMock = stubFetchByRoute({
      // The screen asks for an existing job first, so a reload can return to one that was already paid for.
      "GET /videos/generations/current": { jobId: null },
      "GET /videos/preview": preview,
      // The whole point of this test: the same route fails and then succeeds. `errorRoutes` fixes a route as
      // always-failing and a plain body is always 200, so neither alone can say "this one, then that one".
      "POST /videos/generations": sequence([
        withStatus(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw" }),
        { paidProvider: false, jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") },
      ]),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-summary");
    fireEvent.click(screen.getByTestId("episode-video-open-confirm"));
    fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" }));
    await screen.findByTestId("episode-video-progress");

    const idOf = (nth: number) => JSON.parse(String(callsTo(fetchMock, "/videos/generations")[nth]![1].body)).userRequestId as string;
    expect(typeof idOf(0)).toBe("string");
    expect(idOf(1)).toBe(idOf(0));
  });

  it("mints a new request id when the confirmation is cancelled and opened again", async () => {
    // Cancelling is abandoning the intent. Keeping the id would make the next, genuinely separate attempt look
    // to the server like a retry of the one the person backed out of.
    const fetchMock = stubFetchByRoute(
      {
        // The screen asks for an existing job first, so a reload can return to one that was already paid for.
        "GET /videos/generations/current": { jobId: null },
        "GET /videos/preview": preview,
      },
      // Both submissions fail the same way, and this test is about the two ids being different — not about
      // anything the server said back.
      { "POST /videos/generations": { status: 500, body: { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw" } } },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-summary");
    fireEvent.click(screen.getByTestId("episode-video-open-confirm"));
    fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByTestId("episode-video-open-confirm"));
    fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" }));
    await waitFor(() => expect(countTo(fetchMock, "/videos/generations")).toBe(2));

    const idOf = (nth: number) => JSON.parse(String(callsTo(fetchMock, "/videos/generations")[nth]![1].body)).userRequestId as string;
    expect(idOf(1)).not.toBe(idOf(0));
  });

  /**
   * "에피소드 상태를 확인해 주세요" — asked of an app that already knows.
   *
   * `LONG_EPISODE_VIDEOS_NOT_ALLOWED` is one sentence for every state before the video step, and it sends the
   * person off to look up a status this screen can read. Worse, it reads identically whether the Episode has
   * no script at all or is genuinely stuck, so there is no way to tell "do this next" from "something broke".
   */
  it("names the step to go and do when the video route refuses the whole screen", async () => {
    const fetchMock = stubFetchByRoute(
      { "GET /episodes/1": { episode: episode("outline_ready") } },
      { "GET /videos/generations/current": { status: 409, body: { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED", message: "raw" } } },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const step = await screen.findByTestId("episode-video-next-step");
    expect(step.textContent).toContain("장면 대본");
    // Beneath the refusal, not instead of it — the server's reason stays on screen.
    expect(screen.getByRole("alert").getAttribute("data-error-code")).toBe("LONG_EPISODE_VIDEOS_NOT_ALLOWED");
  });

  it("points at the images once the mapping is approved but no images are ready", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute(
      { "GET /episodes/1": { episode: episode("asset_mapping_approved") } },
      { "GET /videos/generations/current": { status: 409, body: { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED", message: "raw" } } },
    ));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const step = await screen.findByTestId("episode-video-next-step");
    expect(step.textContent).toContain("장면 이미지");
    expect(step.textContent).not.toContain("장면 대본");
  });

  /** A step nobody could read is not a step to name — the refusal alone is the honest floor. */
  it("says nothing extra when the step itself could not be read", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({}, {
      "GET /videos/generations/current": { status: 409, body: { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED", message: "raw" } },
      "GET /episodes/1": { status: 500, body: { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw" } },
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByRole("alert");
    await waitFor(() => expect(screen.queryByTestId("episode-video-next-step")).toBeNull());
  });

  /**
   * The reload bug 캡틴D found: the screen showed "이 단계에서는 영상 작업을 할 수 없습니다" and nothing else after a
   * refresh, because the job id lived only in React state. Everything paid for — the review cards, the players
   * and the recovery button — sat behind that `job`, so $1.50 of finished work had no handle on screen.
   */
  it("restores the Episode's existing video job on mount, so a reload does not strand paid work", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-review");
    expect(screen.getByTestId("episode-video-recover")).toBeTruthy();
    // Restored, not started over: the 미리보기 is what the Episode is past, and asking for it is what produced
    // the "이 단계에서는 할 수 없습니다" line that hid everything else.
    expect(countTo(fetchMock, "/videos/preview")).toBe(0);
  });

  /**
   * The other half of that reload bug, and the half the test above could not see: it hands the lookup a real
   * answer, so a lookup that never answered took the identical path.
   *
   * The route says "no job" with `jobId: null` and a 200 — it never errors to mean that — so a 500 here is the
   * question going unanswered, and answering it as "none" put the paid 미리보기 and its $1.50 in front of an
   * Episode whose clips were already bought, with the 검토 카드 and 회수 버튼 gone and nothing on screen saying
   * why. Asserting the preview was not requested is the assertion that matters: the sentence alone would pass
   * on a screen that showed an error *and* offered to buy everything again.
   */
  it("does not offer to buy the clips again when it could not find out whether a job exists", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": withStatus(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw backend detail" }),
      "GET /videos/preview": preview,
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(countTo(fetchMock, "/videos/preview")).toBe(0);
    expect(screen.queryByTestId("episode-video-open-confirm")).toBeNull();
  });

  /**
   * A finished Episode opening this screen looked broken.
   *
   * The review route serves only videos_review and videos_approved, so once the Episode reaches 완료 it refuses
   * — an ordinary answer to an extra request. But that refusal was caught by the same block as the progress
   * read and drawn as the screen's own error, so the page showed the completed job, all six scenes done, and a
   * red 지금 이 에피소드 단계에서는 영상 작업을 할 수 없습니다 across it. Seen live on 이배드 4화.
   *
   * Asserting the absence of the alert as well as the new line: a sentence added while the red one stayed would
   * leave the screen contradicting itself.
   */
  it("does not render a finished Episode's refusal of the review list as the screen failing", async () => {
    const completed = { ...progress("succeeded", [1, 2, 3, 4, 5, 6]), episode: episode("completed") };
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": completed,
      "GET /videos/generations/job/review": withStatus(409, { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED", message: "raw backend detail" }),
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const line = await screen.findByTestId("episode-video-review-unavailable");
    expect(line.textContent).toContain("완료");
    expect(screen.queryByRole("alert")).toBeNull();
    // The work itself stays on screen — the refusal costs the cards, not the job.
    expect(screen.getByTestId("episode-video-progress")).toBeTruthy();
  });

  /**
   * 🔴 The same refusal, on the path that actually runs while a job is going.
   *
   * The fix above landed on the mount path and nowhere else. `loadProgress` — the poll that repeats every
   * 400ms — made the same review request inside the same try, so the moment a run finished into an Episode
   * past the review stage the red 지금 이 에피소드 단계에서는 영상 작업을 할 수 없습니다 appeared across a
   * finished job whose clips were bought and whose buttons still worked. All three callers of that request go
   * through one function now.
   */
  /**
   * 🔴 One failed poll used to end the polling for good.
   *
   * The catch called `fail("progress", …)` and never `setJob`, so `job` did not change — and the timer effect
   * watched `job` alone, so no next check was ever scheduled. A six-scene paid run kept going behind a screen
   * frozen at whatever it last saw, with a reload as the only way out. It did not take a malformed response:
   * one network blip, or the backend restarting because a file was saved while the app runs from source.
   */
  it("keeps the last progress on screen when a poll fails, says the reading is old, and keeps asking", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": sequence([
        progress("running", [1]),
        withStatus(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw" }),
      ]),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-progress");
    const stale = await screen.findByTestId("episode-video-progress-stale");
    expect(stale.textContent).toContain("마지막으로 확인된 상태");
    // The scene list is still there — the poll failed, the run did not — and no red banner claims otherwise.
    expect(screen.getByTestId("episode-video-progress-1")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // The button the short project's screen has always had in this situation, and this one never did.
    expect(screen.getByTestId("episode-video-progress-recheck")).toBeTruthy();
    await waitFor(() => expect(countTo(fetchMock, "/videos/generations/job")).toBeGreaterThan(2), { timeout: 6000 });
  });

  /**
   * 🔴 The free exit, offered before the paid one.
   *
   * A timeout is us giving up on a task Runway was still working on; a no_output is a finished task whose URL
   * had not appeared yet. Both are written failed, both are already on the ledger, and both usually leave a
   * finished clip at the provider — which recovery now reaches. Until this, the only button in this section
   * was 다시 시도, buying the same seconds twice at $0.25 a scene.
   */
  it("offers the free recovery in the failed-scenes section, and states what it costs afterwards", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": {
        paidProvider: true, jobId: "job", status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2],
        sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating"),
        sceneErrors: { 2: "timeout" },
      },
      "POST /videos/generations/job/recovery": {
        paidProvider: true, jobId: "job", status: "running", completedSceneNumbers: [1, 2], failedSceneNumbers: [],
        sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating"),
        recoveredSceneNumbers: [2], unrecoverableScenes: [],
      },
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-failed-scenes");
    fireEvent.click(screen.getByTestId("episode-video-failed-recover"));

    const confirm = await screen.findByTestId("episode-video-failed-recover-confirm");
    // Both halves, because both are true and only one of them is the reassuring one.
    expect(confirm.textContent).toContain("비용이 들지 않습니다");
    expect(confirm.textContent).toContain("청구됩니다");
    expect(countTo(fetchMock, "/recovery")).toBe(0);

    fireEvent.click(screen.getByTestId("episode-video-failed-recover-confirm-button"));
    await waitFor(() => expect(countTo(fetchMock, "/recovery")).toBe(1));
  });

  it("does not render the review list's refusal as a failure when the progress poll meets it", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": sequence([
        progress("running", [1, 2, 3]),
        { ...progress("succeeded", [1, 2, 3, 4, 5, 6]), episode: episode("completed") },
      ]),
      "GET /videos/generations/job/review": withStatus(409, { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED", message: "raw" }),
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const line = await screen.findByTestId("episode-video-review-unavailable");
    expect(line.textContent).toContain("완료");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * 🔴 The third copy, and the one that reported the opposite of what happened.
   *
   * 가져오기 asked for the review list after a successful recovery, inside the same try. The clips were already
   * back and the download costs nothing — and a refusal of that extra request replaced the recovery's own
   * result with a red line saying the Episode could not do video work.
   */
  it("keeps a successful 가져오기 successful when the review list is refused afterwards", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const recovered = { ...progress("succeeded", [1, 2, 3, 4, 5, 6]), recoveredSceneNumbers: [1, 2, 3, 4, 5, 6], unrecoverableScenes: [] };
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": sequence([
        { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
        withStatus(409, { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED", message: "raw" }),
      ]),
      "POST /videos/generations/job/recovery": recovered,
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    fireEvent.click(await screen.findByTestId("episode-video-recover"));

    await screen.findByTestId("episode-video-recovery-result");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * 캡틴D asked, looking at a red line above a working button: "다시 시도 눌러도 되는거야?"
   *
   * The refusal is about starting video work on this Episode; the buttons above it are actions against a run
   * that already exists, which the backend checks separately. The sentence names its own subject rather than
   * leaving the whole screen to be read as blocked — and the earlier-step advice stays away, because at this
   * step there is no earlier step to go and do.
   */
  it("says which action a refusal is about once the Episode is at or past the video step", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute(
      { "GET /episodes/1": { episode: episode("videos_review") } },
      { "GET /videos/generations/current": { status: 409, body: { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED", message: "raw" } } },
    ));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const said = await screen.findByTestId("episode-video-refusal-subject");
    expect(said.textContent).toContain("영상 검토 중");
    expect(screen.queryByTestId("episode-video-next-step")).toBeNull();
    // Beneath the refusal, never instead of it.
    expect(screen.getByRole("alert").getAttribute("data-error-code")).toBe("LONG_EPISODE_VIDEOS_NOT_ALLOWED");
  });

  /**
   * The ledger records the amount, not the outcome: Episode 5 scene 3 failed twice and left two $0.25 rows
   * behind it with no clip. "이번 시도분이 실제로 청구됩니다" reads as a statement about a successful attempt,
   * and someone who believes a failed attempt is free has no reason not to press the same button again.
   */
  it("says a failed retry is billed too, before the retry is confirmed", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": {
        paidProvider: true, jobId: "job", status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2],
        sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating"),
        sceneErrors: { 2: "An unexpected error occurred. (Runway code: INTERNAL.BAD_OUTPUT.CODE01)" },
      },
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-failed-scenes");
    expect(screen.queryByTestId("episode-video-failed-retry-billing-2")).toBeNull();
    fireEvent.click(screen.getByTestId("episode-video-failed-retry-2"));

    const billing = await screen.findByTestId("episode-video-failed-retry-billing-2");
    expect(billing.textContent).toContain("실패해도 이 시도분은 청구됩니다");
  });

  /**
   * The three answers that used to be one.
   *
   * `sceneErrors` carried a sentence, the client looked the whole sentence up in a table of codes, missed, and
   * fell back to "잠시 후 다시 시도해 주세요" — for the one code whose documented cause is the input itself.
   * 캡틴D followed that advice twice at $0.25 a press. `remedy` is what tells the cases apart, and each case
   * gets a different sentence and a different button.
   */
  const failedWith = (failure: Record<string, unknown>) => ({
    paidProvider: true, jobId: "job", status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2],
    sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating"),
    sceneErrors: { 2: "An unexpected error occurred. (Runway code: INTERNAL.BAD_OUTPUT.CODE01)" },
    sceneFailures: { 2: failure },
  });

  /**
   * 🔴 One failure, two sentences, saying the opposite.
   *
   * A Runway task failure's category is the provider's own English sentence, so the category table missed it
   * every time and fell through to "영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." — the sentence that
   * was followed twice and charged twice — while the remedy advice right below it said the input has to
   * change. The provider's code is what tells them apart, and the contract now carries what each one means.
   */
  it("names the provider's own cause instead of the fallback that told 캡틴D to wait", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": failedWith({ category: "unknown", providerCode: "INTERNAL.BAD_OUTPUT.CODE01", remedy: "change_input", billedOnFailure: true }),
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-failed-scenes");
    const reason = screen.getByTestId("episode-video-failed-reason-2");
    expect(reason.textContent).toContain("글자나 로고");
    expect(reason.textContent).not.toContain("잠시 후");
    // Cause only — the money sentence belongs to billedOnFailure, one place, not two.
    expect(reason.textContent).not.toContain("청구");
    // And the provider's raw English never reaches the screen.
    expect(document.body.textContent).not.toContain("An unexpected error occurred");
  });

  it("holds the retry until something is changed when the provider says the input is the cause", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": failedWith({ category: "unknown", providerCode: "INTERNAL.BAD_OUTPUT.CODE01", remedy: "change_input", billedOnFailure: true }),
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-failed-scenes");
    fireEvent.click(screen.getByTestId("episode-video-failed-retry-2"));

    const remedy = await screen.findByTestId("episode-video-failed-retry-remedy-2");
    // A certainty, not a caution — that is what the code means.
    expect(remedy.textContent).toContain("그대로 다시 보내면 다시 실패합니다");
    expect(remedy.textContent).not.toContain("잠시 후");
    const panel = screen.getByTestId("episode-video-failed-retry-confirm-2");
    const submit = within(panel).getByRole("button", { name: "다시 시도" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByTestId("episode-video-failed-retry-instruction-2"), { target: { value: "간판 글자를 빼고 인물 표정으로 보여준다" } });
    expect(within(panel).getByRole("button", { name: "다시 시도" }).hasAttribute("disabled")).toBe(false);
  });

  /** SAFETY.INPUT / SAFETY.OUTPUT: the same request never passes, so a paid button here sells a known outcome. */
  it("offers no retry at all when the provider says the request cannot pass", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": failedWith({ category: "unknown", providerCode: "SAFETY.INPUT.01", remedy: "not_retryable", billedOnFailure: false }),
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-failed-scenes");
    expect(screen.queryByTestId("episode-video-failed-retry-2")).toBeNull();
    expect(screen.getByTestId("episode-video-failed-not-retryable-2").textContent).toContain("같은 요청으로는 통과하지 않습니다");
  });

  /**
   * 🔴 The billing sentence is asymmetric on purpose.
   *
   * A record stored before `failure_code` existed reports `billedOnFailure: false` for having no code, not for
   * having been free. A wrong "청구되지 않습니다" costs money; a wrong "청구됩니다" costs a moment. So the
   * sentence is withheld on a false rather than inverted.
   */
  it("does not turn a not-billed failure into a promise that nothing was charged", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": failedWith({ category: "timeout", remedy: "retry", billedOnFailure: false }),
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-failed-scenes");
    fireEvent.click(screen.getByTestId("episode-video-failed-retry-2"));

    const remedy = await screen.findByTestId("episode-video-failed-retry-remedy-2");
    expect(remedy.textContent).toContain("그대로 다시 보내도 됩니다");
    expect(screen.queryByTestId("episode-video-failed-retry-billing-2")).toBeNull();
    expect(document.body.textContent).not.toContain("청구되지 않");
    // Nothing is held back: this failure has no input to change.
    const panel = screen.getByTestId("episode-video-failed-retry-confirm-2");
    expect(within(panel).getByRole("button", { name: "다시 시도" }).hasAttribute("disabled")).toBe(false);
  });

  /** A response from a build with no `sceneFailures` must behave exactly as it did — absence is not an answer. */
  it("keeps the pre-contract wording when the response carries no failure detail", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": {
        paidProvider: true, jobId: "job", status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2],
        sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating"),
        sceneErrors: { 2: "An unexpected error occurred." },
      },
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-failed-scenes");
    fireEvent.click(screen.getByTestId("episode-video-failed-retry-2"));

    expect((await screen.findByTestId("episode-video-failed-retry-billing-2")).textContent).toContain("실패해도 이 시도분은 청구됩니다");
    expect(screen.getByTestId("episode-video-failed-retry-remedy-2").textContent).toContain("같은 이유로 다시 실패할 수 있습니다");
    const panel = screen.getByTestId("episode-video-failed-retry-confirm-2");
    expect(within(panel).getByRole("button", { name: "다시 시도" }).hasAttribute("disabled")).toBe(false);
  });

  it("fetches the clips already generated without regenerating any, and names the scenes it could not fetch", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const recovered = { ...progress("succeeded", [1, 2, 3, 4, 5, 6]), recoveredSceneNumbers: [1, 2, 3, 4, 5], unrecoverableScenes: [{ sceneNumber: 6, reason: "출력 링크가 만료되었습니다" }] };
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
      "POST /videos/generations/job/recovery": recovered,
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    fireEvent.click(await screen.findByTestId("episode-video-recover"));
    await waitFor(() => expect(countTo(fetchMock, "/recovery")).toBe(1));

    const result = await screen.findByTestId("episode-video-recovery-result");
    expect(result.textContent).toContain("5장면");
    expect(result.textContent).toContain("6번");
    expect(result.textContent).toContain("출력 링크가 만료되었습니다");
    // Recovery is a download, not a purchase. A scene it could not fetch is reported and left alone —
    // spending $0.25 again is the person's decision, never this screen's fallback.
    expect(countTo(fetchMock, "/regenerate")).toBe(0);
  });

  it("plays each scene from the video content route", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const player = await screen.findByTestId("episode-video-player-1");
    expect(player.getAttribute("src")).toContain("/long-projects/long/episodes/1/videos/1/content");
    expect(screen.getByTestId("episode-video-player-6")).toBeTruthy();
  });

  /**
   * The content route refuses to serve a placeholder, so a scene that never downloaded fails to load instead of
   * playing 32 bytes of nothing. Which sentence that failure earns depends on whether 회수 has already run —
   * before it, the bytes are still fetchable and the answer is a button, not a bill.
   */
  it("tells an unplayable scene apart before and after recovery, and never offers to regenerate on its own", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const recovered = { ...progress("succeeded", [1, 2, 3, 4, 5, 6]), recoveredSceneNumbers: [1, 2, 3, 4, 5], unrecoverableScenes: [{ sceneNumber: 6, reason: "출력 링크가 만료되었습니다" }] };
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
      "POST /videos/generations/job/recovery": recovered,
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    fireEvent.error(await screen.findByTestId("episode-video-player-6"));
    expect((await screen.findByTestId("episode-video-missing-6")).textContent).toContain("아직 가져오지 않았습니다");

    fireEvent.click(screen.getByTestId("episode-video-recover"));
    await screen.findByTestId("episode-video-recovery-result");
    // Recovery clears the remembered failure and changes the URL, so a scene it did fetch is retried rather
    // than replaying the refusal the browser cached a moment earlier.
    fireEvent.error(await screen.findByTestId("episode-video-player-6"));
    expect((await screen.findByTestId("episode-video-missing-6")).textContent).toContain("남아 있지 않습니다");
    expect(countTo(fetchMock, "/regenerate")).toBe(0);
  });

  /**
   * A clip that was paid for and no longer matches the scene it was made from. The short project has said this
   * since the staleness work landed; an Episode said nothing, so the only way to find out was to watch six
   * clips and notice. The server recomputes it from the prompt recorded at generation — not a flag someone has
   * to remember to clear.
   *
   * A warning, not a lock: 확정 stays available. Merging a drifted clip is a legitimate choice once it is one.
   */
  it("marks the scenes whose paid clip no longer matches the script, without blocking them", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      // The review is only fetched once the job reports succeeded, so the progress route has to answer too.
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [2] } },
      ...sceneVersionRoutes(),
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    expect(await screen.findByTestId("episode-video-stale-2")).toBeTruthy();
    // Scene 1 was not reported, and a badge there would be the screen inventing one.
    expect(screen.queryByTestId("episode-video-stale-1")).toBeNull();
    expect(screen.getByTestId("episode-video-review-2")).toBeTruthy();
  });

  /**
   * The direction is used once and never stored, which is what keeps the staleness badge honest: the server
   * records the plain scene prompt separately, so a passing "slower camera" does not make the clip read as
   * behind the script for ever after.
   */
  it("sends a one-off direction with a video regeneration", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
      // The video route is /scenes/<n>/regenerate; /review/<n>/... is the image screen's shape.
      "POST /videos/generations/job/scenes/2/regenerate": progress("running", []),
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-review-2");
    fireEvent.click(screen.getAllByRole("button", { name: "다시 만들기" })[1]!);
    fireEvent.change(await screen.findByTestId("episode-video-regenerate-instruction-2"), { target: { value: "카메라를 더 천천히" } });
    // The confirm says something the opener does not: one of these two opens a question, the other spends
    // money, and naming both "다시 만들기" made the paid one indistinguishable — here and on screen.
    fireEvent.click(screen.getByRole("button", { name: "예, 다시 생성합니다" }));

    await waitFor(() => {
      const post = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>)
        .find(([url, init]) => String(url).endsWith("/scenes/2/regenerate") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({ approved: true, additionalInstruction: "카메라를 더 천천히" });
    });
  });

  /**
   * The point is not that twelve presses became one. It is that twelve presses never once said what all twelve
   * cost: each per-scene confirmation quoted one scene, and nothing quoted the whole. This is the first place
   * that number appears — so the confirmation has to carry it, and the button has to say it is buying all of
   * them.
   */
  it("re-buys every scene from one confirmation that quotes all of them, carrying the direction to each", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
      "POST /videos/generations/job/regenerate-all": progress("running", []),
      ...sceneVersionRoutes(),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-review-2");
    fireEvent.click(screen.getByTestId("episode-video-regenerate-all"));
    fireEvent.change(await screen.findByTestId("episode-video-regenerate-all-instruction"), { target: { value: "  전체적으로 더 어둡게  " } });
    // Its own confirm wording: "전부" is what separates spending six scenes' worth from spending one.
    fireEvent.click(screen.getByTestId("episode-video-regenerate-all-confirm-button"));

    await waitFor(() => {
      const post = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>)
        .find(([url, init]) => String(url).endsWith("/generations/job/regenerate-all") && init?.method === "POST");
      expect(post).toBeTruthy();
      // Trimmed by the client too: the same words with different spacing must not become a different request.
      expect(JSON.parse(String(post![1]!.body))).toEqual({ approved: true, additionalInstruction: "전체적으로 더 어둡게" });
    });
    // And it never went through the single-scene route, which would have bought one and looked like six.
    expect((fetchMock.mock.calls as Array<[string, RequestInit | undefined]>)
      .some(([url]) => String(url).includes("/scenes/"))).toBe(false);
  });

  /**
   * The number that never existed before: each per-scene confirmation quoted one scene, and nothing quoted the
   * whole Episode. A confirmation for six scenes that shows one scene's price is worse than showing none.
   */
  it("quotes all six scenes in the whole-Episode confirmation, not one", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const withEstimate = {
      ...progress("succeeded", [1, 2, 3, 4, 5, 6]),
      retryEstimate: { perSceneCostUsd: 0.25, budget: { perRequestCostUsd: 0.25, spentUsd: 1, remainingUsd: 9, monthlyLimitUsd: 10, canSpend: true } },
    };
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": withEstimate,
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
      ...sceneVersionRoutes(),
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-review-2");
    fireEvent.click(screen.getByTestId("episode-video-regenerate-all"));

    const cost = await screen.findByTestId("episode-video-regenerate-all-cost");
    expect(cost.textContent).toContain("$1.50");
    expect(cost.textContent).toContain("6장면");
  });

  /**
   * Same rule as the short project's screen, and it had to be the same rule: one screen enforcing it and one
   * not is worse than neither, because the next person reading either cannot tell which is the convention.
   */
  it("never leaves two differently-priced confirmations open at once", async () => {
    const review = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /videos/generations/current": { jobId: "job" },
      "GET /videos/generations/job": progress("succeeded", [1, 2, 3, 4, 5, 6]),
      "GET /videos/generations/job/review": { episode: episode("videos_review"), reviews: review, staleness: { videoStale: [] } },
      ...sceneVersionRoutes(),
    }));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-review-2");
    fireEvent.click(screen.getByTestId("episode-video-regenerate-all"));
    expect(await screen.findByTestId("episode-video-regenerate-all-confirm")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "다시 만들기" })[1]!);

    expect(await screen.findByTestId("episode-video-regenerate-instruction-2")).toBeTruthy();
    expect(screen.queryByTestId("episode-video-regenerate-all-confirm")).toBeNull();
  });
});
