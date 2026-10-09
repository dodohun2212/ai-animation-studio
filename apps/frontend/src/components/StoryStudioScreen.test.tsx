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
    render(<StoryStudioScreen onCreated={() => {}} />);
    const panel = screen.getByTestId("story-not-yet");
    expect(panel.textContent).toContain("Reddit 주소만 넣어 글 가져오기");
    expect(panel.textContent).toContain("사전 승인과 이용 조건");
    expect(panel.textContent).toContain("등장인물을 자동으로 뽑고");
    expect(panel.querySelector("button")).toBeNull();
    await screen.findByTestId("story-title");
  });

  /** M0: 분량 칸을 화면에서 뺐다 — 설정 칸처럼 보이지 않게, 기본값으로 만들고 장기 프로젝트 설정에서 조절한다(회차 나누기 화면에는 조절 UI가 없다 — CLI 1310). */
  it("has no episode or scene count fields — they start from the defaults", async () => {
    mockServer();
    render(<StoryStudioScreen onCreated={() => {}} />);
    await screen.findByTestId("story-title");
    expect(screen.queryByTestId("story-episodes")).toBeNull();
    expect(screen.queryByTestId("story-scenes")).toBeNull();
    expect(STORY_DEFAULTS).toEqual({ episodeCount: 3, sceneCount: 6 });
  });

  /** CLI 1310: M0 의 실제 동작을 말한다 — 원문은 개요에 그대로 저장되고 기존 개요 AI 가 읽는다. 재창작을 확정 표현으로 약속하지 않는다. */
  it("states what M0 really does and does not promise a rewrite", async () => {
    mockServer();
    const { container } = render(<StoryStudioScreen onCreated={() => {}} />);
    await screen.findByTestId("story-title");
    const notice = screen.getByTestId("story-m0-notice").textContent ?? "";
    expect(notice).toContain("그대로 저장");
    expect(notice).toContain("구조적으로 막지는 못합니다");
    const page = container.textContent ?? "";
    expect(page).not.toContain("원문을 그대로 쓰지 않고 새 이야기로 다시 씁니다");
    expect(page).not.toContain("새 이야기로 다시 쓰도록 지시하지만");
    expect(page).toContain("장기 프로젝트 설정");
    expect(page).not.toContain("거기서 조절합니다");
  });

  it("asks for the required fields before sending anything", async () => {
    const fetchMock = mockServer();
    render(<StoryStudioScreen onCreated={() => {}} />);
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
    render(<StoryStudioScreen onCreated={onCreated} />);
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
    render(<StoryStudioScreen onCreated={() => {}} />);
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
    render(<StoryStudioScreen onCreated={onCreated} />);
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
    render(<StoryStudioScreen onCreated={onCreated} />);
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
    render(<StoryStudioScreen onCreated={() => {}} />);
    fireEvent.click(screen.getByTestId("story-add-character"));
    await waitFor(() => expect(screen.getByText("보관함 캐릭터 목록을 불러오지 못했습니다. 짝짓기 없이 적을 수 있습니다.")).toBeTruthy());
    expect(screen.getByTestId("story-character-asset-0")).toBeTruthy();
  });
});
