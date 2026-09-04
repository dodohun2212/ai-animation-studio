import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject, sceneStaleness } from "../api/testUtils.js";
import { SceneEditScreen } from "./SceneEditScreen.js";

function scene(number: number, overrides: Record<string, string> = {}): Scene {
  return {
    number: number as Scene["number"],
    script: `Script ${number}`,
    motionPrompt: `Motion ${number}`,
    description: `설명 ${number}`,
    narration: `문장 ${number}`,
    visual_action: `행동 ${number}`,
    shot_size: "medium",
    camera_angle: "eye",
    composition: "centered",
    lens_feel: "natural",
    focus_subject: "hero",
    start_motion: "start",
    main_motion: "main",
    end_motion: "end",
    expression_change: "calm",
    camera_motion: "dolly",
    environment_motion: "wind",
    motion_speed: "normal",
    motion_intensity: "moderate",
    continuity_hint: "hint",
    ...overrides,
  } as Scene;
}

const PROJECT_URL = "/projects/sample_project";
const PATCH_URL = "/projects/sample_project/scenes/1";

function stubFetchByRoute(
  routes: Record<string, unknown>,
  errorRoutes: Record<string, { status: number; body: unknown }> = {},
): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    if (key in errorRoutes) return jsonResponse(errorRoutes[key]!.status, errorRoutes[key]!.body);
    if (!(key in routes)) throw new Error(`Unexpected fetch: ${key}`);
    return jsonResponse(200, routes[key]);
  });
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<SceneEditScreen projectId="sample_project" onBack={() => {}} />);
}

const noStaleness = sceneStaleness();

describe("SceneEditScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fills the form with the scene's current values", async () => {
    const project = makeProject({ scenes: [scene(1), scene(2)] });
    renderScreen(stubFetchByRoute({ [`GET ${PROJECT_URL}`]: { project } }));

    expect(await screen.findByDisplayValue("행동 1")).toBeTruthy();
    expect(screen.getByDisplayValue("문장 1")).toBeTruthy();
    expect(screen.getByDisplayValue("설명 1")).toBeTruthy();
  });

  it("states what each group of fields will make stale before anything is edited", async () => {
    const project = makeProject({ scenes: [scene(1)] });
    renderScreen(stubFetchByRoute({ [`GET ${PROJECT_URL}`]: { project } }));

    await screen.findByDisplayValue("행동 1");
    // The consequence has to be visible up front, not only after saving.
    // getByLabelText("구도") is ambiguous here: the composition field's own label text is also "구도".
    expect(screen.getByTestId("scene-edit-group-구도").textContent).toContain("이미지를 다시 만들어야");
    expect(screen.getByLabelText("움직임").textContent).toContain("이미지는 그대로 쓸 수 있습니다");
    expect(screen.getByLabelText("다음 장면과의 연결").textContent).toContain("다음 장면의 영상");
    expect(screen.getByLabelText("화면 대본").textContent).toContain("다시 만들 것이 없습니다");
  });

  it("keeps save disabled until something actually changes", async () => {
    const project = makeProject({ scenes: [scene(1)] });
    renderScreen(stubFetchByRoute({ [`GET ${PROJECT_URL}`]: { project } }));

    await screen.findByDisplayValue("행동 1");
    expect(screen.getByTestId("scene-edit-save")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("주요 동작"), { target: { value: "새 동작" } });
    expect(screen.getByTestId("scene-edit-save")).not.toBeDisabled();
    expect(screen.getByTestId("scene-edit-change-count").textContent).toContain("1개");

    // Typing the original value back is not a change.
    fireEvent.change(screen.getByLabelText("주요 동작"), { target: { value: "main" } });
    expect(screen.getByTestId("scene-edit-save")).toBeDisabled();
  });

  it("sends only the fields that changed", async () => {
    const project = makeProject({ scenes: [scene(1)] });
    const fetchMock = stubFetchByRoute({
      [`GET ${PROJECT_URL}`]: { project },
      [`PATCH ${PATCH_URL}`]: { project, staleness: noStaleness },
    });
    renderScreen(fetchMock);

    await screen.findByDisplayValue("행동 1");
    fireEvent.change(screen.getByLabelText("읽어줄 문장"), { target: { value: "고친 문장" } });
    fireEvent.click(screen.getByTestId("scene-edit-save"));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === PATCH_URL)).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url]) => String(url) === PATCH_URL)!;
    expect(JSON.parse(String((patchCall[1] as RequestInit).body))).toEqual({ scene: { narration: "고친 문장" } });
  });

  it("reports which scenes now need regenerating, including the next scene", async () => {
    const project = makeProject({ scenes: [scene(1), scene(2)] });
    renderScreen(
      stubFetchByRoute({
        [`GET ${PROJECT_URL}`]: { project },
        [`PATCH ${PATCH_URL}`]: { project, staleness: sceneStaleness({ videoStale: [1, 2] }) },
      }),
    );

    await screen.findByDisplayValue("행동 1");
    fireEvent.change(screen.getByLabelText("마무리 동작"), { target: { value: "새 마무리" } });
    fireEvent.click(screen.getByTestId("scene-edit-save"));

    // Editing scene 1's ending motion also invalidates scene 2's video.
    expect((await screen.findByTestId("scene-edit-stale-video")).textContent).toContain("1, 2");
    expect(screen.queryByTestId("scene-edit-stale-image")).toBeNull();
  });

  /**
   * The guard behind this response checked three of the five lists the contract requires, while telling the
   * compiler all five had arrived. A response short a list is a server this screen cannot read, and saying so is
   * the only honest answer — a saved panel built on two undefined lists is not.
   */
  it("refuses a save whose staleness is missing a list the contract requires", async () => {
    const project = makeProject({ scenes: [scene(1), scene(2)] });
    const { styleStale: _dropped, ...short } = sceneStaleness();
    renderScreen(
      stubFetchByRoute({
        [`GET ${PROJECT_URL}`]: { project },
        [`PATCH ${PATCH_URL}`]: { project, staleness: short },
      }),
    );

    await screen.findByDisplayValue("행동 1");
    fireEvent.change(screen.getByLabelText("마무리 동작"), { target: { value: "새 마무리" } });
    fireEvent.click(screen.getByTestId("scene-edit-save"));

    expect((await screen.findByRole("alert")).textContent).toContain("서버 응답을 확인할 수 없습니다");
    expect(screen.queryByTestId("scene-edit-saved")).toBeNull();
  });

  it("says plainly when an edit costs nothing to redo", async () => {
    const project = makeProject({ scenes: [scene(1)] });
    renderScreen(
      stubFetchByRoute({
        [`GET ${PROJECT_URL}`]: { project },
        [`PATCH ${PATCH_URL}`]: { project, staleness: noStaleness },
      }),
    );

    await screen.findByDisplayValue("행동 1");
    fireEvent.change(screen.getByLabelText("장면 대본"), { target: { value: "새 대본" } });
    fireEvent.click(screen.getByTestId("scene-edit-save"));

    expect((await screen.findByTestId("scene-edit-saved")).textContent).toContain("다시 만들어야 할 것은 없습니다");
  });

  it("drops edits when switching to another scene rather than carrying them over", async () => {
    const project = makeProject({ scenes: [scene(1), scene(2)] });
    renderScreen(stubFetchByRoute({ [`GET ${PROJECT_URL}`]: { project } }));

    await screen.findByDisplayValue("행동 1");
    fireEvent.change(screen.getByLabelText("주요 동작"), { target: { value: "안 저장한 값" } });
    fireEvent.click(screen.getByTestId("scene-edit-tab-2"));

    expect(screen.getByDisplayValue("행동 2")).toBeTruthy();
    expect(screen.getByTestId("scene-edit-save")).toBeDisabled();
    fireEvent.click(screen.getByTestId("scene-edit-tab-1"));
    // Scene 1 shows its stored value again, not the abandoned draft.
    expect(screen.getByLabelText("주요 동작")).toHaveValue("main");
  });

  it("clears the previous scene's save error and save result when another scene is opened", async () => {
    // These two used to be cleared by an effect on [selected], together with the draft. That effect also ran
    // on the null -> first-scene transition the initial load causes, which is the race that wiped what a fast
    // typist had already entered; the reset now hangs off the tab click instead. Moving it is only safe if
    // everything it used to clear still gets cleared, so all three are asserted here — the draft has its own
    // test above, and these are the two that had none.
    const project = makeProject({ scenes: [scene(1), scene(2)] });
    renderScreen(
      stubFetchByRoute(
        { [`GET ${PROJECT_URL}`]: { project } },
        {
          [`PATCH ${PATCH_URL}`]: {
            status: 400,
            body: { code: "INVALID_REQUEST", message: "scene contains unsupported fields: foo" },
          },
        },
      ),
    );

    await screen.findByDisplayValue("행동 1");
    fireEvent.change(screen.getByLabelText("읽어줄 문장"), { target: { value: "고친 문장" } });
    fireEvent.click(screen.getByTestId("scene-edit-save"));
    await screen.findByTestId("scene-edit-save-error");

    fireEvent.click(screen.getByTestId("scene-edit-tab-2"));
    expect(screen.queryByTestId("scene-edit-save-error")).toBeNull();
    expect(screen.queryByTestId("scene-edit-saved")).toBeNull();
  });

  it("keeps an edit made right after the scenes appear", async () => {
    // The defect this stands for: the field was filled in, the text vanished on its own, and the save button
    // went back to disabled with nothing said. It only happened inside the gap between the inputs being
    // painted and a passive effect running, so this test cannot fail on the old code — @testing-library
    // flushes effects before handing control back, which closes that gap. It is kept as the statement of what
    // must hold, not as the proof: the proof is that no effect resets the draft any more (see openScene), and
    // that the previously intermittent "sends only the fields that changed" case stays green under repetition.
    const project = makeProject({ scenes: [scene(1), scene(2)] });
    renderScreen(stubFetchByRoute({ [`GET ${PROJECT_URL}`]: { project } }));

    await screen.findByDisplayValue("행동 1");
    fireEvent.change(screen.getByLabelText("주요 동작"), { target: { value: "빠르게 고친 값" } });

    expect(screen.getByLabelText("주요 동작")).toHaveValue("빠르게 고친 값");
    expect(screen.getByTestId("scene-edit-save")).not.toBeDisabled();
  });


  it("shows a safe message instead of the backend's own text when a save is rejected", async () => {
    const project = makeProject({ scenes: [scene(1)] });
    renderScreen(
      stubFetchByRoute(
        { [`GET ${PROJECT_URL}`]: { project } },
        {
          [`PATCH ${PATCH_URL}`]: {
            status: 400,
            body: { code: "INVALID_REQUEST", message: "scene contains unsupported fields: foo" },
          },
        },
      ),
    );

    await screen.findByDisplayValue("행동 1");
    fireEvent.change(screen.getByLabelText("읽어줄 문장"), { target: { value: "고친 문장" } });
    fireEvent.click(screen.getByTestId("scene-edit-save"));

    const error = await screen.findByTestId("scene-edit-save-error");
    expect(error.textContent).not.toContain("unsupported fields");
    expect(error.textContent).toContain("다시 확인해 주세요");
  });
});
