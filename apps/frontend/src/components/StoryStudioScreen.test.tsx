import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeAsset, makeAssetFolder, makeLongProject, stubFetchByRoute } from "../api/testUtils.js";
import { STORY_DEFAULTS, STORY_TEXT_LIMIT, StoryStudioScreen, autoStoryProjectId, buildStoryNotes } from "./StoryStudioScreen.js";

const FOLDER = makeAssetFolder({ assetId: "ASSET-CHAR-FOLDER", assetType: "character", displayName: "토리" });
const CHILD = makeAsset({ assetId: "ASSET-CHAR-CHILD", assetType: "character", displayName: "토리 웃는 얼굴", parentFolderId: "ASSET-CHAR-FOLDER" });
const SOLO = makeAsset({ assetId: "ASSET-CHAR-SOLO", assetType: "character", displayName: "미니", parentFolderId: "" });

function mockServer(extra: Record<string, unknown> = {}) {
  const fetchMock = stubFetchByRoute({ "GET /assets?assetType=character": { assets: [FOLDER, CHILD, SOLO] }, ...extra });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map(([url, init]) => ({ method: (init as RequestInit | undefined)?.method ?? "GET", url: String(url), body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : undefined }))
    .filter((call) => call.method !== "GET");

function fill(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

describe("story helpers", () => {
  it("builds a folder-safe name and a notes block with the rewrite instruction, source and cast", () => {
    expect(autoStoryProjectId("달빛 아래의 문!", new Date(2026, 9, 9, 14, 5, 7))).toBe("이야기_달빛_아래의_문_1009_140507");
    const notes = buildStoryNotes("Reddit 글", [{ name: "하나", description: "수줍은 직장인", assetName: "토리" }, { name: "  ", description: "무시", assetName: null }]);
    expect(notes).toContain("재창작 지시");
    expect(notes).toContain("그대로 옮기지 말고");
    expect(notes).toContain("출처 메모】 Reddit 글");
    expect(notes).toContain("- 하나: 수줍은 직장인 (이미지 보관함 캐릭터: 토리)");
    expect(notes).not.toContain("무시");
  });
});

describe("StoryStudioScreen", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("says plainly what does not work yet, as text and not as buttons", async () => {
    mockServer();
    render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    const panel = screen.getByTestId("story-not-yet");
    expect(panel.textContent).toContain("Reddit 주소만 넣어 글 가져오기");
    expect(panel.textContent).toContain("사전 승인과 이용 조건");
    // 인물 자동 추출·이미지 등록은 이제 있다(AI 분석 + 인물 이미지) — 「준비 중」으로 과소 안내하지 않는다(CLI 1325).
    expect(panel.textContent).not.toContain("등장인물을 자동으로 뽑고");
    expect(panel.querySelector("button")).toBeNull();
    await screen.findByTestId("story-title");
  });

  /** M1: AI 분석이 회차 구성의 개수를 입력으로 받아서 회차 수·장면 수 칸이 다시 생겼다. 처음 값은 기본값(3·6). */
  it("has the episode and scene count fields again, starting from the defaults", async () => {
    mockServer();
    render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    await screen.findByTestId("story-title");
    expect((screen.getByTestId("story-episodes") as HTMLInputElement).value).toBe("3");
    expect((screen.getByTestId("story-scenes") as HTMLInputElement).value).toBe("6");
    expect(STORY_DEFAULTS).toEqual({ episodeCount: 3, sceneCount: 6 });
  });

  /** M1: 분석 미리보기는 입력이 다 차야 열리고, 칸의 값(회차 수·장면 수·출처 메모)을 그대로 요청에 싣는다. 빈 출처 메모는 보내지 않는다. */
  it("opens the analysis preview only for a complete form and sends the form values", async () => {
    const fetchMock = mockServer({
      "POST /story-analysis/preview": {
        preview: { inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), prompt: "프롬프트", model: "gpt-5.6-luna", sourceCharacterCount: 4, estimatedCostUsd: 0.05, providerAvailable: true },
      },
    });
    render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    await screen.findByTestId("story-title");
    expect((screen.getByTestId("story-preview-run") as HTMLButtonElement).disabled).toBe(true);
    fill("story-title", "달빛 문");
    fill("story-logline", "문을 발견한다");
    fill("story-text", "본문");
    expect((screen.getByTestId("story-preview-run") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("story-rights"));
    expect((screen.getByTestId("story-preview-run") as HTMLButtonElement).disabled).toBe(false);

    fill("story-episodes", "5");
    fill("story-scenes", "8");
    fireEvent.click(screen.getByTestId("story-preview-run"));
    await screen.findByTestId("story-preview");
    const call = sent(fetchMock).find((entry) => entry.url === "/story-analysis/preview")!;
    expect(call.body).toEqual({ sourceText: "본문", title: "달빛 문", logline: "문을 발견한다", rightsConfirmed: true, episodeCount: 5, sceneCount: 8 });
    expect("sourceNote" in call.body).toBe(false);
    expect(sent(fetchMock).some((entry) => entry.url === "/story-analysis")).toBe(false);
  });

  it("sends the source note to the analysis only when one was written", async () => {
    const fetchMock = mockServer({
      "POST /story-analysis/preview": {
        preview: { inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), prompt: "프롬프트", model: "gpt-5.6-luna", sourceCharacterCount: 4, estimatedCostUsd: 0.05, providerAvailable: true },
      },
    });
    render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    await screen.findByTestId("story-title");
    fill("story-title", "t");
    fill("story-logline", "l");
    fill("story-text", "본문");
    fill("story-source", "  작가 이름  ");
    fireEvent.click(screen.getByTestId("story-rights"));
    fireEvent.click(screen.getByTestId("story-preview-run"));
    await screen.findByTestId("story-preview");
    expect(sent(fetchMock).find((entry) => entry.url === "/story-analysis/preview")!.body.sourceNote).toBe("작가 이름");
  });

  /** CLI 1326: 입력칸에서 Enter(폼 제출)로는 분석 없는 만들기가 일어나지 않고, 전용 버튼을 눌러야만 만들어진다. */
  it("does not create a project when Enter submits the form from a field", async () => {
    const fetchMock = mockServer({ "POST /long-projects": { project: makeLongProject() } });
    const onCreated = vi.fn();
    render(<StoryStudioScreen onCreated={onCreated} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    await screen.findByTestId("story-title");
    fill("story-title", "달빛 문");
    fill("story-logline", "문을 발견한다");
    fill("story-text", "본문");
    fireEvent.click(screen.getByTestId("story-rights"));
    fireEvent.submit(screen.getByTestId("story-studio-form"));
    fireEvent.keyDown(screen.getByTestId("story-title"), { key: "Enter", code: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent(fetchMock)).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
    expect((screen.getByTestId("story-submit") as HTMLButtonElement).type).toBe("button");
    fireEvent.click(screen.getByTestId("story-submit"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock).filter((call) => call.url === "/long-projects")).toHaveLength(1);
  });

  /** CLI 1327: 이야기 만들기는 장기 프로젝트의 한 시작 방법이라는 관계를 첫 화면이 말하고, 다른 방법·목록으로 갈 길이 있다. */
  it("says it is one way to start a long project, and can go back or switch to the direct setup", async () => {
    mockServer();
    const onBack = vi.fn();
    const onStartDirect = vi.fn();
    const { container } = render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={onBack} onStartDirect={onStartDirect} onOpenSettings={() => {}} />);
    await screen.findByTestId("story-title");
    const page = container.textContent ?? "";
    expect(page).toContain("장기 프로젝트 · 새 작품");
    expect(page).toContain("만들어진 것은 같은 장기 프로젝트");
    expect(page).toContain("분석 없이 만들면 붙여넣은 글은 프로젝트 개요에");
    expect(page).not.toContain("소설에서 인물을 자동으로 뽑는 기능은 준비 중");
    fireEvent.click(screen.getByTestId("story-start-direct"));
    expect(onStartDirect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /새 작품 만들기로/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("asks for the required fields before sending anything", async () => {
    const fetchMock = mockServer();
    render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByTestId("story-submit"));
    expect((await screen.findByTestId("story-error")).textContent).toContain("제목");
    fill("story-title", "달빛 문");
    fireEvent.click(screen.getByTestId("story-submit"));
    expect(screen.getByTestId("story-error").textContent).toContain("한 줄 줄거리");
    fill("story-logline", "문을 발견한다");
    fireEvent.click(screen.getByTestId("story-submit"));
    expect(screen.getByTestId("story-error").textContent).toContain("본문");
    expect(sent(fetchMock)).toEqual([]);
  });

  /** CLI 1305: 남의 글이면 권리 문제가 남는다 — 직접 쓴 글이거나 허락받은 글이라는 확인 없이는 만들지 않는다. */
  it("will not create anything until the person confirms the text is theirs or permitted", async () => {
    const fetchMock = mockServer({ "POST /long-projects": { project: makeLongProject() } });
    const onCreated = vi.fn();
    render(<StoryStudioScreen onCreated={onCreated} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    fill("story-title", "t");
    fill("story-logline", "l");
    fill("story-text", "본문");
    fireEvent.click(screen.getByTestId("story-submit"));
    expect((await screen.findByTestId("story-error")).textContent).toContain("이용 허락");
    expect(sent(fetchMock)).toEqual([]);
    fireEvent.click(screen.getByTestId("story-rights"));
    fireEvent.click(screen.getByTestId("story-submit"));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(sent(fetchMock)[0]!.body.settings.notes).toContain("권리 확인");
  });

  it("refuses a text over the limit and shows the count", async () => {
    const fetchMock = mockServer();
    render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    fill("story-title", "t");
    fill("story-logline", "l");
    fill("story-text", "가".repeat(STORY_TEXT_LIMIT + 1));
    expect(screen.getByTestId("story-text-count").textContent).toContain("줄여서 붙여 주세요");
    fireEvent.click(screen.getByTestId("story-submit"));
    expect(screen.getByTestId("story-error").textContent).toContain("넘었습니다");
    expect(sent(fetchMock)).toEqual([]);
  });

  /** 🔴 보내는 것은 장기 프로젝트 생성 한 번뿐 — OpenAI·Runway·이미지 생성 요청은 없다. */
  it("creates exactly one long project with the story, the rewrite note and the cast, then hands it over", async () => {
    const project = makeLongProject();
    const fetchMock = mockServer({ "POST /long-projects": { project } });
    const onCreated = vi.fn();
    render(<StoryStudioScreen onCreated={onCreated} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    await screen.findByTestId("story-title");
    fill("story-title", "달빛 문");
    fill("story-logline", "평범한 직장인이 낯선 문을 발견한다");
    fill("story-text", "어느 날 밤, 하나는 같은 꿈을 꾸었다. 문이 열렸다.");
    fill("story-source", "Reddit 글");
    fireEvent.click(screen.getByTestId("story-rights"));
    fireEvent.click(screen.getByTestId("story-add-character"));
    fill("story-character-name-0", "하나");
    fill("story-character-desc-0", "수줍은 직장인");
    await waitFor(() => expect(screen.getByTestId("story-character-asset-0")).toBeTruthy());
    expect(Array.from((screen.getByTestId("story-character-asset-0") as HTMLSelectElement).options).map((option) => option.value)).toEqual(["", "ASSET-CHAR-FOLDER", "ASSET-CHAR-SOLO"]);
    fill("story-character-asset-0", "ASSET-CHAR-FOLDER");
    fireEvent.click(screen.getByTestId("story-submit"));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    const calls = sent(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("/long-projects");
    expect(calls[0]!.body.projectId).toMatch(/^이야기_달빛_문_\d{4}_\d{6}$/);
    expect(calls[0]!.body.settings).toMatchObject({ title: "달빛 문", logline: "평범한 직장인이 낯선 문을 발견한다", overview: "어느 날 밤, 하나는 같은 꿈을 꾸었다. 문이 열렸다.", episodeCount: STORY_DEFAULTS.episodeCount, sceneCount: STORY_DEFAULTS.sceneCount, aspectRatio: "9:16" });
    expect(calls[0]!.body.settings.notes).toContain("재창작 지시");
    expect(calls[0]!.body.settings.notes).toContain("- 하나: 수줍은 직장인 (이미지 보관함 캐릭터: 토리)");
    expect(calls[0]!.body.settings.episodeDurationSeconds).toBeUndefined();
  });

  it("keeps what was typed and shows the server's message when creation fails", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /assets?assetType=character": { assets: [] } }, { "POST /long-projects": { status: 400, body: { code: "LONG_PROJECT_ALREADY_EXISTS", message: "raw" } } }));
    const onCreated = vi.fn();
    render(<StoryStudioScreen onCreated={onCreated} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    fill("story-title", "t");
    fill("story-logline", "l");
    fill("story-text", "본문");
    fireEvent.click(screen.getByTestId("story-rights"));
    fireEvent.click(screen.getByTestId("story-submit"));
    expect((await screen.findByTestId("story-error")).textContent).not.toBe("");
    expect(onCreated).not.toHaveBeenCalled();
    expect((screen.getByTestId("story-text") as HTMLTextAreaElement).value).toBe("본문");
  });

  it("still works when the library cannot be read", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({}, { "GET /assets?assetType=character": { status: 500, body: { code: "X", message: "boom" } } }));
    render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByTestId("story-add-character"));
    await waitFor(() => expect(screen.getByText("보관함 캐릭터 목록을 불러오지 못했습니다. 짝짓기 없이 적을 수 있습니다.")).toBeTruthy());
    expect(screen.getByTestId("story-character-asset-0")).toBeTruthy();
  });
});
