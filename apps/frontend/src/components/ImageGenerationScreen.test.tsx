import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageReview, Scene } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { ImageGenerationScreen } from "./ImageGenerationScreen.js";
import { workflowStateLabel } from "../utils/workflowStateLabels.js";

function sixScenes(withImages: readonly number[] = []): Scene[] {
  return [1, 2, 3, 4, 5, 6].map((number) => ({
    number: number as Scene["number"],
    script: `Scene ${number}`,
    imagePrompt: `Image ${number}`,
    motionPrompt: `Motion ${number}`,
    imageReview: "pending",
    videoReview: "pending",
    ...(withImages.includes(number) ? { generatedImagePath: `images/scene${number}.png` } : {}),
  }));
}

function sixReviews(approved: readonly number[] = []): ImageReview[] {
  return [1, 2, 3, 4, 5, 6].map((number) => ({
    sceneNumber: number as ImageReview["sceneNumber"],
    status: approved.includes(number) ? "approved" : "pending",
    updatedAt: "2026-08-22T00:00:00.000Z",
  }));
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<ImageGenerationScreen projectId="sample_project" onBack={() => {}} />);
}

describe("ImageGenerationScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then loads the project via GET /projects/:projectId", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    expect(screen.getByText("불러오는 중...")).toBeTruthy();
    await screen.findByTestId("provider-mode-notice");

    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project");
  });

  it("shows the project-load error with its code identifiable via data-error-code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { code: "PROJECT_NOT_FOUND", message: "프로젝트를 찾을 수 없습니다." }));
    renderScreen(fetchMock);

    const alert = await screen.findByTestId("load-error");
    expect(alert.textContent).toBe("프로젝트를 찾을 수 없습니다.");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_NOT_FOUND");
  });

  it("says up front that a connected key means real paid requests, and shows all six scenes as pending before generation", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    const notice = await screen.findByTestId("provider-mode-notice");
    expect(notice.textContent).toContain("실제 유료 요청이 전송됩니다");

    for (const number of [1, 2, 3, 4, 5, 6]) {
      const item = screen.getByTestId(`scene-${number}`);
      expect(item).toHaveAttribute("data-status", "pending");
    }
  });

  it("reflects previously completed scenes as completed before a fresh generation call", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes([1, 2]) });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    await screen.findByTestId("provider-mode-notice");
    expect(screen.getByTestId("scene-1")).toHaveAttribute("data-status", "completed");
    expect(screen.getByTestId("scene-2")).toHaveAttribute("data-status", "completed");
    expect(screen.getByTestId("scene-3")).toHaveAttribute("data-status", "pending");
  });

  it("shows live progress while the blocking generation request is in flight, not six rows saying 대기", async () => {
    // `startImageGeneration` is one POST that does not return until every scene is done. Until it did, the
    // screen showed 대기 six times next to a 생성 중 button — indistinguishable from a frozen app.
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const midRun = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes([1, 2]) });
    let finishGeneration: (response: Response) => void = () => {};
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/images") && (init as RequestInit | undefined)?.method === "POST") {
        return new Promise<Response>((resolve) => { finishGeneration = resolve; });
      }
      /* The progress route, not the project. `generatedImagePath` is never mapped onto the scenes, so polling
         the project reported 0/6 for the whole run however many pictures existed — the bar this test is about
         could not move. The route answers from the same question the generation loop asks before skipping a
         scene, and says which one is being drawn as well as how many are done. */
      if (url.endsWith("/images/generations/progress")) {
        return Promise.resolve(jsonResponse(200, {
          project: midRun,
          progress: { sceneNumbers: [1, 2, 3, 4, 5, 6], completedSceneNumbers: [1, 2], currentSceneNumber: 3 },
        }));
      }
      return Promise.resolve(jsonResponse(200, { project }));
    });
    renderScreen(fetchMock);

    await screen.findByTestId("provider-mode-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    await screen.findByTestId("generate-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "예, 이미지 생성을 시작합니다" }));

    const progress = await screen.findByTestId("generation-progress");
    expect(progress.textContent).toContain("0/6장 완료");
    // Nothing has been polled yet, so no row is demoted to 대기 on no evidence.
    expect(screen.getByTestId("scene-1").textContent).toContain("만드는 중");

    await waitFor(() => expect(screen.getByTestId("generation-progress").textContent).toContain("2/6장 완료"), { timeout: 5000 });
    expect(screen.getByTestId("scene-1")).toHaveAttribute("data-status", "completed");

    finishGeneration(jsonResponse(200, { project: midRun, generatedSceneNumbers: [1, 2], reusedSceneNumbers: [] }));
  });

  /**
   * The half the count alone cannot show: which scene the money is being spent on right now.
   *
   * Every unfinished row said 만드는 중 — true of the batch and false of five of the six rows carrying it. The
   * route names the scene, so the rows can say the three different things that are actually true, and a person
   * watching can see the run advance rather than a wall of identical labels.
   */
  it("marks the scene being drawn apart from the ones still queued", async () => {
    const running = makeProject({ workflowState: WorkflowState.GeneratingImages, scenes: sixScenes() });
    renderScreen(vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/images/generations/progress")
      ? jsonResponse(200, { project: running, progress: { sceneNumbers: [1, 2, 3, 4, 5, 6], completedSceneNumbers: [1, 2], currentSceneNumber: 3 } })
      : jsonResponse(200, { project: running })));

    await screen.findByTestId("generation-progress");
    // Waited on 완료, not on 만드는 중: the row already says 만드는 중 before any poll lands, from the
    // batch-level fallback, so gating on it lets the assertions below run against the pre-progress state — the
    // first poll is 3s away. 완료 is reachable only from completedSceneNumbers.
    await waitFor(() => expect(screen.getByTestId("scene-1").textContent).toContain("완료"), { timeout: 5000 });
    expect(screen.getByTestId("scene-3").textContent).toContain("만드는 중");
    expect(screen.getByTestId("scene-5").textContent).toContain("대기 중");
    // And the one being drawn is the only one claiming to be drawn.
    expect(screen.getByTestId("scene-5").textContent).not.toContain("만드는 중");
  });

  /**
   * A poll that never answered is not a poll that answered "nothing is happening". Silence has to leave the
   * rows saying what was true before it — the batch is running — rather than demoting five of them to 대기,
   * which would read as a stalled run and is exactly what makes a person press a paid button twice.
   */
  it("keeps the batch-level answer when the progress read fails", async () => {
    const running = makeProject({ workflowState: WorkflowState.GeneratingImages, scenes: sixScenes() });
    renderScreen(vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/images/generations/progress")
      ? jsonResponse(500, { code: "IMAGE_STORAGE_ERROR", message: "raw backend detail" })
      : jsonResponse(200, { project: running })));

    await screen.findByTestId("generation-progress");
    expect(screen.getByTestId("scene-1").textContent).toContain("만드는 중");
    expect(screen.getByTestId("scene-5").textContent).toContain("만드는 중");
  });

  /**
   * The short project folds a mapped Asset's description text into the prompt, so swapping an Asset for a
   * different one already showed up as imageStale. What it could not see was the common case: the bytes come
   * from whatever version the mapping points at, folder mappings follow the latest, and redrawing the same
   * character changes every byte sent while the description stays identical.
   *
   * Two badges rather than one because the causes differ. "장면 내용이 바뀌었다" is false here — the words are
   * untouched — and saying it sends someone to re-read a scene that is fine.
   */
  it("separates a picture behind its script from one behind its references", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, {
      project, reviews: sixReviews(),
      staleness: { imageStale: [1], videoStale: [], narrationStale: [], referenceStale: [2] },
    })));

    expect((await screen.findByTestId("review-stale-1")).textContent).toContain("내용 바뀜");
    expect(screen.queryByTestId("reference-stale-1")).toBeNull();

    const reference = screen.getByTestId("reference-stale-2");
    expect(reference.textContent).toContain("참고 이미지 바뀜");
    expect(reference.textContent).not.toContain("내용 바뀜");
    expect(screen.queryByTestId("review-stale-2")).toBeNull();
  });

  /**
   * `generatePending` is local state, so a reload during a run left the screen showing six rows reading 대기
   * and no panel — while images were being bought. The workflow state is the fact that survives the reload.
   */
  it("recovers a run that was already going when the screen opened", async () => {
    const running = makeProject({ workflowState: WorkflowState.GeneratingImages, scenes: sixScenes() });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project: running })));

    const progress = await screen.findByTestId("generation-progress");
    expect(progress.textContent).toContain("이 화면을 벗어나거나");
    // No row says 대기 while the batch is running — that reading is what makes a person press again.
    expect(screen.getByTestId("scene-1").textContent).toContain("만드는 중");
    // The clock is not claimed for a run whose start time the screen does not know.
    expect(screen.getByTestId("generation-progress-resumed")).toBeTruthy();
    expect(progress.textContent).not.toContain("초째 진행 중");
  });

  it("says nothing about a run when the project is not generating", async () => {
    const idle = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project: idle })));

    await screen.findByTestId("provider-mode-notice");
    expect(screen.queryByTestId("generation-progress")).toBeNull();
    expect(screen.getByTestId("scene-1").textContent).toContain("대기");
  });

  it("blocks generation and hides the start button when the project is not Asset-Mapping-approved", async () => {
    const project = makeProject({ workflowState: WorkflowState.Ready, scenes: [] });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    const notAllowed = await screen.findByTestId("not-allowed");
    // Shows the Korean label now — the enum reaching the screen was the bug.
    expect(notAllowed.textContent).toContain(workflowStateLabel(WorkflowState.Ready));
    expect(notAllowed.textContent).not.toContain(WorkflowState.Ready);
    expect(screen.queryByRole("button", { name: "이미지 생성 시작" })).toBeNull();
  });

  it("does not call the generation endpoint on the first click — it only opens an explicit confirmation panel", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    await screen.findByTestId("provider-mode-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));

    const panel = await screen.findByTestId("generate-confirm-panel");
    expect(panel).toBeTruthy();
    expect(screen.getByRole("button", { name: "예, 이미지 생성을 시작합니다" })).toBeTruthy();
    // Only the initial GET happened — the first click never sent a generation request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns to the scene list without sending anything when the confirmation panel is cancelled", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    await screen.findByTestId("provider-mode-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    await screen.findByTestId("generate-confirm-panel");

    fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(screen.queryByTestId("generate-confirm-panel")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls POST /projects/:projectId/images/generations with { approved: true } only after the final confirmation click, then loads review status", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const generatedProject = makeProject({
      workflowState: WorkflowState.ImagesReview,
      scenes: sixScenes([1, 2, 3, 4, 5, 6]),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(
        jsonResponse(200, { project: generatedProject, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { project: generatedProject, reviews: sixReviews() }));
    renderScreen(fetchMock);

    await screen.findByTestId("provider-mode-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    await screen.findByTestId("generate-confirm-panel");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "예, 이미지 생성을 시작합니다" }));

    const summary = await screen.findByTestId("generation-summary");
    expect(summary.textContent).toContain("새로 생성 6장");
    expect(summary.textContent).toContain("기존 이미지 재사용 0장");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/images/generations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });

    for (const number of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`scene-${number}`)).toHaveAttribute("data-status", "completed");
    }
    expect(screen.queryByRole("button", { name: "이미지 생성 시작" })).toBeNull();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]![0]).toBe("/projects/sample_project/images/review");
    for (const number of [1, 2, 3, 4, 5, 6]) {
      expect(await screen.findByTestId(`review-${number}`)).toHaveAttribute("data-status", "pending");
    }
  });

  it("shows a safe error and keeps the confirmation panel open for retry when generation fails", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "IMAGE_GENERATION_FAILED", message: "raw backend detail" }));
    renderScreen(fetchMock);

    await screen.findByTestId("provider-mode-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    await screen.findByTestId("generate-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "예, 이미지 생성을 시작합니다" }));

    const alert = await screen.findByTestId("generate-error");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "IMAGE_GENERATION_FAILED");
    expect(screen.getByTestId("generate-confirm-panel")).toBeTruthy();
    expect(screen.queryByTestId("generation-summary")).toBeNull();
  });

  it("prevents a duplicate generation POST while one is already in flight", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    let resolveGeneration: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveGeneration = resolve;
        }),
      )
      .mockResolvedValue(jsonResponse(200, { project: makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) }), reviews: sixReviews() }));
    renderScreen(fetchMock);

    await screen.findByTestId("provider-mode-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    await screen.findByTestId("generate-confirm-panel");

    const confirmButton = screen.getByRole("button", { name: "예, 이미지 생성을 시작합니다" });
    fireEvent.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 project GET + exactly one generation POST
    resolveGeneration(
      jsonResponse(200, {
        project: makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) }),
        generatedSceneNumbers: [1, 2, 3, 4, 5, 6],
        reusedSceneNumbers: [],
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("generate-confirm-panel")).toBeNull());
  });

  it("loads image review status via GET when a reloaded project is already in IMAGES_REVIEW state", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1, 2]) }));
    renderScreen(fetchMock);

    await screen.findByTestId("provider-mode-notice");
    // The review request is scheduled by the post-project-load effect, so wait
    // for that dependent effect instead of treating the first rendered notice
    // as proof that it has already run.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project/images/review"));

    expect(await screen.findByTestId("review-1")).toHaveAttribute("data-status", "approved");
    expect(screen.getByTestId("review-2")).toHaveAttribute("data-status", "approved");
    expect(screen.getByTestId("review-3")).toHaveAttribute("data-status", "pending");
    // Already-approved scenes cannot be re-submitted. This used to read "the row's first button is disabled",
    // which only held because a permanently-disabled 확정 완료 button happened to be first; that dead button is
    // gone, so the property is now stated directly — the row offers no approve control at all.
    const approvedRow = screen.getByTestId("review-1");
    expect(within(approvedRow).queryByRole("button", { name: "이 이미지로 확정" })).toBeNull();
    expect(within(approvedRow).queryByRole("button", { name: "확정 완료" })).toBeNull();
    // No absolute or relative file path is ever rendered on screen.
    expect(document.body.textContent).not.toContain("images/scene1.png");
  });

  it("shows each scene's actual generated image, cache-busted by its review updatedAt", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1]) }));
    renderScreen(fetchMock);

    const image = await screen.findByTestId("review-image-1");
    expect(image).toHaveAttribute("src", "/projects/sample_project/images/1/content?v=2026-08-22T00%3A00%3A00.000Z");
    expect(screen.getByTestId("review-image-6")).toHaveAttribute("src", "/projects/sample_project/images/6/content?v=2026-08-22T00%3A00%3A00.000Z");
  });

  // Regression: the Backend caps how many Reference images one request may carry and used to drop the rest with
  // no signal at all — a character folder past the cap simply stopped influencing the picture, and the only
  // symptom was that the result looked wrong for reasons nothing on screen explained.
  it("says how many reference images were actually used when the cap dropped some, and stays quiet otherwise", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const reviews = sixReviews();
    reviews[0] = { ...reviews[0]!, referencesUsedCount: 16, referencesOmittedCount: 4 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews }));
    renderScreen(fetchMock);

    const notice = await screen.findByTestId("review-references-omitted-1");
    // Both halves matter: the total is what the user recognises as "what I linked", the used count is what
    // actually reached the model. Neither number is derived from a cap this screen knows on its own.
    expect(notice.textContent).toContain("20");
    expect(notice.textContent).toContain("16");
    // A scene the cap never touched must stay silent — a notice on every card teaches people to ignore it.
    expect(screen.queryByTestId("review-references-omitted-2")).toBeNull();
  });

  it("shows no not-allowed message once the project has reached IMAGES_REVIEW or later", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews() }));
    renderScreen(fetchMock);

    await screen.findByTestId("image-review-section");
    expect(screen.queryByTestId("not-allowed")).toBeNull();
  });

  it("sends an explicit POST /images/review/:sceneNumber/approve for a single scene and preserves the others as pending", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews() }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([2]) }));
    renderScreen(fetchMock);

    const sceneTwoRow = await screen.findByTestId("review-2");
    fireEvent.click(sceneTwoRow.querySelector("button")!);

    await waitFor(() => expect(screen.getByTestId("review-2")).toHaveAttribute("data-status", "approved"));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/images/review/2/approve");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });

    for (const number of [1, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`review-${number}`)).toHaveAttribute("data-status", "pending");
    }
  });

  it("shows a safe per-scene approval error without losing the other scenes' state, and allows retry", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1]) }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "IMAGE_REVIEW_STORAGE_ERROR", message: "raw disk failure detail" }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1, 3]) }));
    renderScreen(fetchMock);

    const sceneThreeRow = await screen.findByTestId("review-3");
    fireEvent.click(sceneThreeRow.querySelector("button")!);

    const alert = await screen.findByTestId("review-approve-error-3");
    expect(alert.textContent).not.toContain("raw disk failure detail");
    expect(alert).toHaveAttribute("data-error-code", "IMAGE_REVIEW_STORAGE_ERROR");
    // Scene 1 (already approved) and other pending scenes are unaffected by scene 3's failure.
    expect(screen.getByTestId("review-1")).toHaveAttribute("data-status", "approved");
    expect(screen.getByTestId("review-3")).toHaveAttribute("data-status", "pending");

    // Retry succeeds and clears the error.
    fireEvent.click(screen.getByTestId("review-3").querySelector("button")!);
    await waitFor(() => expect(screen.getByTestId("review-3")).toHaveAttribute("data-status", "approved"));
    expect(screen.queryByTestId("review-approve-error-3")).toBeNull();
  });

  it("shows the transition to WAITING_FOR_VIDEO_CONFIRMATION once the sixth scene is approved", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const waitingProject = makeProject({
      workflowState: WorkflowState.WaitingForVideoConfirmation,
      scenes: sixScenes([1, 2, 3, 4, 5, 6]),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1, 2, 3, 4, 5]) }))
      .mockResolvedValueOnce(jsonResponse(200, { project: waitingProject, reviews: sixReviews([1, 2, 3, 4, 5, 6]) }));
    renderScreen(fetchMock);

    const sceneSixRow = await screen.findByTestId("review-6");
    fireEvent.click(sceneSixRow.querySelector("button")!);

    const transition = await screen.findByTestId("video-confirmation-transition");
    expect(transition.textContent).toContain("영상 생성 확인");
    // The review section stays available at WAITING_FOR_VIDEO_CONFIRMATION so a scene can
    // still be regenerated after all six scenes were approved.
    expect(screen.getByTestId("image-review-section")).toBeTruthy();
    for (const number of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`review-${number}`)).toHaveAttribute("data-status", "approved");
    }
  });

  it("does not call the regenerate endpoint on the first click — it only opens an explicit per-scene confirmation panel", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1]) }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("review-regenerate-2"));

    const panel = await screen.findByTestId("regenerate-confirm-panel-2");
    expect(panel.textContent).toContain("키가 연결되어 있으면 이번 재생성분이 실제로 청구됩니다");
    // Only the two GETs happened — opening the panel never sent a regenerate request.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels the regenerate confirmation without sending anything", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1]) }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("review-regenerate-2"));
    const panel = await screen.findByTestId("regenerate-confirm-panel-2");
    fireEvent.click(within(panel).getByRole("button", { name: "취소" }));

    expect(screen.queryByTestId("regenerate-confirm-panel-2")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("calls POST /images/review/:sceneNumber/regenerate with { approved: true } only after the final confirmation click, resets the scene to pending, and preserves the other scenes' approvals", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const regeneratedProject = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1, 2, 3, 4, 5, 6]) }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          project: regeneratedProject,
          reviews: sixReviews([1, 3, 4, 5, 6]),
          sceneNumber: 2,
        }),
      );
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("review-regenerate-2"));
    const panel = await screen.findByTestId("regenerate-confirm-panel-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(within(panel).getByRole("button", { name: "예, 다시 생성합니다" }));

    await waitFor(() => expect(screen.getByTestId("review-2")).toHaveAttribute("data-status", "pending"));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/images/review/2/regenerate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });

    expect(screen.queryByTestId("regenerate-confirm-panel-2")).toBeNull();
    for (const number of [1, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`review-${number}`)).toHaveAttribute("data-status", "approved");
    }
    // No absolute or relative file path is ever rendered on screen.
    expect(document.body.textContent).not.toContain("images/scene2.png");
  });

  it("shows a safe error and keeps the panel open for retry when regeneration fails, without affecting other scenes", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1, 2, 3, 4, 5, 6]) }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "IMAGE_REVIEW_STORAGE_ERROR", message: "raw disk failure detail" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { project, reviews: sixReviews([1, 3, 4, 5, 6]), sceneNumber: 2 }),
      );
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("review-regenerate-2"));
    const panel = await screen.findByTestId("regenerate-confirm-panel-2");
    fireEvent.click(within(panel).getByRole("button", { name: "예, 다시 생성합니다" }));

    const alert = await screen.findByTestId("review-regenerate-error-2");
    expect(alert.textContent).not.toContain("raw disk failure detail");
    expect(alert).toHaveAttribute("data-error-code", "IMAGE_REVIEW_STORAGE_ERROR");
    // The panel stays open so the user can retry, and other scenes are unaffected.
    expect(screen.getByTestId("regenerate-confirm-panel-2")).toBeTruthy();
    for (const number of [1, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`review-${number}`)).toHaveAttribute("data-status", "approved");
    }

    fireEvent.click(within(screen.getByTestId("regenerate-confirm-panel-2")).getByRole("button", { name: "예, 다시 생성합니다" }));
    await waitFor(() => expect(screen.getByTestId("review-2")).toHaveAttribute("data-status", "pending"));
    expect(screen.queryByTestId("review-regenerate-error-2")).toBeNull();
  });

  it("prevents a duplicate regenerate POST for the same scene while one is already in flight", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    let resolveRegenerate: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews([1, 2, 3, 4, 5, 6]) }))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveRegenerate = resolve;
        }),
      );
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("review-regenerate-2"));
    const panel = await screen.findByTestId("regenerate-confirm-panel-2");
    const confirmButton = within(panel).getByRole("button", { name: "예, 다시 생성합니다" });
    fireEvent.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(3); // 2 GETs + exactly one regenerate POST
    resolveRegenerate(
      jsonResponse(200, { project, reviews: sixReviews([1, 3, 4, 5, 6]), sceneNumber: 2 }),
    );
    await waitFor(() => expect(screen.queryByTestId("regenerate-confirm-panel-2")).toBeNull());
  });

  it("allows regenerating a scene from WAITING_FOR_VIDEO_CONFIRMATION, moving the project back to IMAGES_REVIEW while other approvals are preserved", async () => {
    const waitingProject = makeProject({
      workflowState: WorkflowState.WaitingForVideoConfirmation,
      scenes: sixScenes([1, 2, 3, 4, 5, 6]),
    });
    const regeneratedProject = makeProject({
      workflowState: WorkflowState.ImagesReview,
      scenes: sixScenes([1, 2, 3, 4, 5, 6]),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project: waitingProject }))
      .mockResolvedValueOnce(jsonResponse(200, { project: waitingProject, reviews: sixReviews([1, 2, 3, 4, 5, 6]) }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          project: regeneratedProject,
          reviews: sixReviews([2, 3, 4, 5, 6]),
          sceneNumber: 1,
        }),
      );
    renderScreen(fetchMock);

    const transition = await screen.findByTestId("video-confirmation-transition");
    expect(transition).toBeTruthy();
    fireEvent.click(await screen.findByTestId("review-regenerate-1"));
    const panel = await screen.findByTestId("regenerate-confirm-panel-1");
    fireEvent.click(within(panel).getByRole("button", { name: "예, 다시 생성합니다" }));

    await waitFor(() => expect(screen.getByTestId("review-1")).toHaveAttribute("data-status", "pending"));
    expect(screen.queryByTestId("video-confirmation-transition")).toBeNull();
    for (const number of [2, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`review-${number}`)).toHaveAttribute("data-status", "approved");
    }
  });

  it("shows the estimated cost before generation is approved", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));

    // 6 scenes x $0.10 — visible before anything is sent, not after.
    expect(screen.getByTestId("generate-cost-estimate").textContent).toContain("$0.60");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("quotes only the scenes that still need making, and warns that existing ones are not redrawn", async () => {
    // `generate()` reuses a valid existing image for free, so quoting six scenes on a project that already has
    // three overstates the cost — and, more importantly, hides that pressing this will not redraw those three.
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes([1, 2, 3]) });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));

    expect(screen.getByTestId("generate-cost-estimate").textContent).toContain("$0.30");
    expect(screen.getByTestId("generate-cost-estimate").textContent).not.toContain("$0.60");
    const reuse = screen.getByTestId("reuse-notice");
    expect(reuse.textContent).toContain("3장");
    expect(reuse.textContent).toContain("재생성");
  });

  it("shows the budget the generation response reported", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const generated = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(
        jsonResponse(201, {
          project: generated,
          generatedSceneNumbers: [1, 2, 3, 4, 5, 6],
          reusedSceneNumbers: [],
          budget: { monthlyLimitUsd: 10, spentUsd: 2.6, remainingUsd: 7.4, estimatedRequestCostUsd: 0.6, canSpend: true },
        }),
      )
      .mockResolvedValue(jsonResponse(200, { project: generated, reviews: sixReviews() }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "예, 이미지 생성을 시작합니다" }));

    const budget = await screen.findByTestId("generation-budget");
    expect(budget.textContent).toContain("$7.40");
    expect(budget.textContent).toContain("$2.60");
  });

  it("omits the budget line entirely when the response reported none (local fake mode charges nothing)", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const generated = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(
        jsonResponse(201, { project: generated, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }),
      )
      .mockResolvedValue(jsonResponse(200, { project: generated, reviews: sixReviews() }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "예, 이미지 생성을 시작합니다" }));

    await screen.findByTestId("generation-summary");
    expect(screen.queryByTestId("generation-budget")).toBeNull();
  });

  it("shows the retry cost inside a regenerate confirmation once an estimate is known", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          project,
          reviews: sixReviews(),
          budget: { monthlyLimitUsd: 10, spentUsd: 1, remainingUsd: 9, estimatedRequestCostUsd: 0.1, canSpend: true },
        }),
      );
    renderScreen(fetchMock);

    const reviewBudget = await screen.findByTestId("review-budget");
    expect(reviewBudget.textContent).toContain("$9.00");
  });

  it("sends a one-off direction with the regeneration, and nothing when the field is left blank", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews() }))
      .mockResolvedValue(jsonResponse(200, { project, reviews: sixReviews(), sceneNumber: 2 }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("review-regenerate-2"));
    fireEvent.change(screen.getByTestId("regenerate-instruction-2"), { target: { value: "  더 어둡게  " } });
    fireEvent.click(within(screen.getByTestId("regenerate-confirm-panel-2")).getByRole("button", { name: "예, 다시 생성합니다" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/regenerate"))).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/regenerate"))!;
    // Trimmed before sending.
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ approved: true, additionalInstruction: "더 어둡게" });
  });

  it("omits the direction field from the request when it is left empty", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project, reviews: sixReviews() }))
      .mockResolvedValue(jsonResponse(200, { project, reviews: sixReviews(), sceneNumber: 2 }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("review-regenerate-2"));
    fireEvent.click(within(screen.getByTestId("regenerate-confirm-panel-2")).getByRole("button", { name: "예, 다시 생성합니다" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/regenerate"))).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/regenerate"))!;
    // A blank box must produce a plain regeneration, not additionalInstruction: "".
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ approved: true });
  });

  // The review block is the only place the pictures appeared, and it renders only at 이미지 검토 and 영상 확인 —
  // so moving past those made all six vanish. They are still on disk; a stage is not a reason to hide what
  // that stage produced. Same fix as the Episode screen, for the same complaint.
  it("keeps the pictures reachable after the review step is over", async () => {
    const project = makeProject({ workflowState: WorkflowState.ReviewingVideos, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    const gallery = await screen.findByTestId("scene-image-gallery");
    expect(gallery.querySelectorAll("img").length).toBe(6);
  });

  it("does not show the gallery twice while the review block is already showing the same pictures", async () => {
    // 영상 확인 still renders the review block, so a gallery there would print every scene a second time.
    const project = makeProject({ workflowState: WorkflowState.WaitingForVideoConfirmation, scenes: sixScenes([1, 2, 3, 4, 5, 6]) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValue(jsonResponse(200, { project, reviews: sixReviews([1, 2, 3, 4, 5, 6]) }));
    renderScreen(fetchMock);

    await screen.findByTestId("scene-1");
    expect(screen.queryByTestId("scene-image-gallery")).toBeNull();
  });

});
