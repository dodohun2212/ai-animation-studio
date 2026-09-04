import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, sequence, stubFetchByRoute, withStatus } from "../api/testUtils.js";
import { LongEpisodeVideoWorkflowScreen } from "./LongEpisodeVideoWorkflowScreen.js";

const episode = (status: string) => ({ episodeNumber: 1, title: "Episode", summary: "s", mainEvent: "e", conflict: "c", cliffhanger: "h", nextEpisodeHook: "n", status, approved: true, scriptRevision: 1, scriptHistoryCount: 1 });
const preview = { confirmationId: "confirm", model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene: 5, executionMode: "sequential", estimatedCostUsd: 1.5, scenes: [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, prompt: `prompt ${sceneNumber}`, estimatedCostUsd: .25 })) };
const progress = (status: "created" | "running" | "succeeded" | "interrupted", completed: number[] = []) => ({ jobId: "job", status, completedSceneNumbers: completed, failedSceneNumbers: [], sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode(status === "succeeded" ? "videos_review" : "videos_generating") });
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
      "POST /videos/generations": { jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") },
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
      "POST /videos/generations": { jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") },
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
      jobId: "job", status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2, 3], sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating"),
      sceneErrors: { 2: "authentication", 3: "Runway rejected the prompt: explicit content detected" },
    };
    const retriedJob = { jobId: "job", status: "running", completedSceneNumbers: [1], currentSceneNumber: 2, failedSceneNumbers: [], sceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") };
    const fetchMock = stubFetchByRoute({
      "GET /videos/generations/current": { jobId: null },
      "GET /videos/preview": preview,
      "POST /videos/generations": { jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") },
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
        { jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") },
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
