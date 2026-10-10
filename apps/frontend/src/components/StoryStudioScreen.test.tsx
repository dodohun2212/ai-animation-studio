import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeAsset, makeAssetFolder, makeLongProject, stubFetchByRoute } from "../api/testUtils.js";
import { STORY_DEFAULTS, STORY_TEXT_LIMIT, StoryStudioScreen, autoStoryProjectId, buildStoryNotes } from "./StoryStudioScreen.js";

const FOLDER = makeAssetFolder({ assetId: "ASSET-CHAR-FOLDER", assetType: "character", displayName: "토리" });
const CHILD = makeAsset({ assetId: "ASSET-CHAR-CHILD", assetType: "character", displayName: "토리 웃는 얼굴", parentFolderId: "ASSET-CHAR-FOLDER" });
const SOLO = makeAsset({ assetId: "ASSET-CHAR-SOLO", assetType: "character", displayName: "미니", parentFolderId: "" });

function mockServer(extra: Record<string, unknown> = {}) {
  const fetchMock = stubFetchByRoute({
    "GET /assets?assetType=character": { assets: [FOLDER, CHILD, SOLO] },
    "POST /story-sources/search": { provider: "project-gutenberg", results: [], page: 1, hasNextPage: false },
    ...extra,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * 바깥으로 무언가를 만들거나 보내는 요청들. 「작품 고르기」가 열 때 부르는 후보 목록(`/story-sources/search`, CLI 1351)은
 * 읽기 전용 목록이라 POST 여도 여기서 뺍니다 — 이 테스트들이 지키는 것은 「프로젝트·분석 요청이 버튼 없이 나가지 않는다」입니다.
 */
const sent = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map(([url, init]) => ({ method: (init as RequestInit | undefined)?.method ?? "GET", url: String(url), body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : undefined }))
    .filter((call) => call.method !== "GET" && call.url !== "/story-sources/search");

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
        preview: { inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), prompt: "프롬프트", prompts: ["프롬프트"], sourceChunkCount: 1, providerCallCount: 1, model: "gpt-5.6-luna", sourceCharacterCount: 4, estimatedCostUsd: 0.05, providerAvailable: true },
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
        preview: { inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), prompt: "프롬프트", prompts: ["프롬프트"], sourceChunkCount: 1, providerCallCount: 1, model: "gpt-5.6-luna", sourceCharacterCount: 4, estimatedCostUsd: 0.05, providerAvailable: true },
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

  /** CLI 1345: 「작품 고르기」로 고른 본문이 칸에 들어가고, 권리 확인은 다시 받으며, 분석 입력에 원문 없는 출처 기록(`source`)이 실린다. */
  it("fills the story from a picked public-domain work and sends its citation with the analysis", async () => {
    const book = { provider: "project-gutenberg", sourceId: "2147", title: "The Raven", authors: [{ name: "Poe, Edgar Allan", deathYear: 1849 }], translators: [], language: "en", subjects: ["Poetry"], sourceUrl: "https://www.gutenberg.org/ebooks/2147", rightsEvidence: "저자 사망 1849년" };
    const fetchMock = mockServer({
      "POST /story-sources/search": { provider: "project-gutenberg", results: [book], page: 1, hasNextPage: false },
      "POST /story-sources/import": { book, fullSourceCharacterCount: 12, chapters: [{ number: 1, title: "The Raven", characterCount: 12 }], needsChapterRange: false, selectedCharacterCount: 12, sourceText: "Once upon a." },
      "POST /story-analysis/preview": {
        preview: { inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), prompt: "프롬프트", prompts: ["프롬프트"], sourceChunkCount: 1, providerCallCount: 1, model: "gpt-5.6-luna", sourceCharacterCount: 12, estimatedCostUsd: 0.05, providerAvailable: true },
      },
    });
    render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    await screen.findByTestId("story-title");
    fireEvent.click(screen.getByTestId("story-rights"));
    fill("novel-source-query", "poe");
    fireEvent.click(screen.getByTestId("novel-source-search"));
    // CLI 1349: 본문 칸이 비어 있으면 「이 작품 가져오기」 한 번으로 곧바로 채워진다.
    fireEvent.click(await screen.findByTestId("novel-source-check-2147"));

    await waitFor(() => expect((screen.getByTestId("story-text") as HTMLTextAreaElement).value).toBe("Once upon a."));
    expect((screen.getByTestId("story-title") as HTMLInputElement).value).toBe("The Raven");
    expect((screen.getByTestId("story-source") as HTMLInputElement).value).toBe("The Raven — Poe, Edgar Allan (~1849) · Project Gutenberg #2147");
    expect(screen.getByTestId("story-imported-source").textContent).toContain("저자 사망 1849년");
    // 근거가 바뀌었으니 권리 확인은 다시 — 문구도 만료 작품용으로 바뀐다.
    expect((screen.getByTestId("story-rights") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("story-rights").closest("label")!.textContent).toContain("저작권 보호기간이 끝난 작품");

    fill("story-logline", "까마귀가 찾아온다");
    fireEvent.click(screen.getByTestId("story-rights"));
    fireEvent.click(screen.getByTestId("story-preview-run"));
    await screen.findByTestId("story-preview");
    const body = sent(fetchMock).find((entry) => entry.url === "/story-analysis/preview")!.body;
    expect(body.sourceText).toBe("Once upon a.");
    expect(body.source).toMatchObject({ provider: "project-gutenberg", sourceId: "2147", fullSourceCharacterCount: 12, selectedCharacterCount: 12, rightsEvidence: "저자 사망 1849년" });
    expect(JSON.stringify(body.source)).not.toContain("Once upon a.");
    expect(sent(fetchMock).some((entry) => entry.url === "/story-analysis")).toBe(false);

    fill("story-text", "Once upon a. edited");
    expect(screen.getByTestId("story-imported-edited")).toBeTruthy();
    fireEvent.click(screen.getByTestId("story-imported-clear"));
    expect(screen.queryByTestId("story-imported-source")).toBeNull();
    expect(screen.getByTestId("story-rights").closest("label")!.textContent).toContain("직접 쓴 글이거나");
  });

  it("writes the public-domain basis into the project notes when made without analysis", () => {
    const citation = { provider: "project-gutenberg" as const, sourceId: "2147", title: "The Raven", authors: [{ name: "Poe, Edgar Allan", deathYear: 1849 }], translators: [], language: "en" as const, sourceUrl: "https://www.gutenberg.org/ebooks/2147", rightsEvidence: "저자 사망 1849년", fullSourceCharacterCount: 100, selectedCharacterCount: 40, chapterRange: { firstChapter: 2, lastChapter: 3 } };
    const notes = buildStoryNotes("", [], true, citation);
    expect(notes).toContain("저작권 보호기간이 끝난 작품");
    expect(notes).toContain("The Raven — Poe, Edgar Allan (~1849) · Project Gutenberg #2147 · 2–3장");
    expect(notes).not.toContain("직접 썼거나");
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
    // M4(CLI 1334): 6,000자를 넘으면 「분석 없이 만들기」만 막히고(버튼이 꺼진다), AI 분석으로는 진행할 수 있다고 말한다.
    expect(screen.getByTestId("story-text-count").textContent).toContain("AI 분석으로만 진행할 수 있습니다");
    expect((screen.getByTestId("story-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("story-submit"));
    expect(sent(fetchMock)).toEqual([]);
  });

  /** CLI 1334: 경로별 한도 — 6,000자를 넘어도 AI 분석은 120,000자까지 미리보기로 갈 수 있고, 그보다 길면 둘 다 막힌다. */
  it("lets a long text go to the AI analysis but not to the direct creation, and stops both past the analysis limit", async () => {
    mockServer();
    render(<StoryStudioScreen onCreated={() => {}} onProjectFromAnalysis={() => {}} onBack={() => {}} onStartDirect={() => {}} onOpenSettings={() => {}} />);
    await screen.findByTestId("story-title");
    fill("story-title", "t");
    fill("story-logline", "l");
    fireEvent.click(screen.getByTestId("story-rights"));
    fill("story-text", "가".repeat(90_000));
    expect((screen.getByTestId("story-preview-run") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("story-submit") as HTMLButtonElement).disabled).toBe(true);

    fill("story-text", "가".repeat(120_001));
    expect((screen.getByTestId("story-preview-run") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("story-submit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("story-text-count").textContent).toContain("너무 깁니다");
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
