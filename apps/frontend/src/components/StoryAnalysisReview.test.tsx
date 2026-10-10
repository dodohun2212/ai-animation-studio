import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApproveNovelStoryAnalysisResponse } from "@ai-animation-studio/shared";
import { makeAsset, makeAssetFolder, makeLongProject, sequence, stubFetchByRoute } from "../api/testUtils.js";
import { REVIEW_LIMITS, StoryAnalysisReview, normalizeProtagonist } from "./StoryAnalysisReview.js";

function response(overrides: Partial<ApproveNovelStoryAnalysisResponse> = {}): ApproveNovelStoryAnalysisResponse {
  return {
    analysis: {
      title: "달빛 문",
      logline: "낯선 문 뒤의 세계",
      genre: "판타지",
      tone: "몽환적",
      theme: "용기",
      characters: [
        { id: "c1", name: "새봄", role: "protagonist", appearance: "짧은 머리의 직장인", personality: "조용하고 호기심 많다" },
        { id: "c2", name: "문지기", role: "supporting", appearance: "회색 망토", personality: "수수께끼 같다" },
      ],
      episodes: [
        { episodeNumber: 1, title: "첫 번째 꿈", summary: "새봄이 문을 본다.", mainEvent: "문 발견", conflict: "두려움", cliffhanger: "문이 열린다", nextEpisodeHook: "안에서 목소리가 난다" },
        { episodeNumber: 2, title: "문 너머", summary: "새봄이 들어간다.", mainEvent: "입장", conflict: "길을 잃음", cliffhanger: "문지기 등장", nextEpisodeHook: "문지기의 제안" },
      ],
      warnings: ["실존 인물로 보이는 이름이 있어 새 이름으로 바꾸었습니다."],
    },
    source: { inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), title: "달빛 문", sourceNote: "직접 쓴 글", rightsConfirmedAt: "2026-10-10T01:00:00.000Z", analyzedAt: "2026-10-10T01:00:05.000Z", model: "gpt-5.6-luna", episodeCount: 2, sceneCount: 7 },
    reused: false,
    saved: true,
    ...overrides,
  };
}

const CREATE = "POST /long-projects/from-story-analysis";
const FOLDER = makeAssetFolder({ assetId: "ASSET-CHAR-FOLDER", assetType: "character", displayName: "토리" });
const CHILD = makeAsset({ assetId: "ASSET-CHAR-CHILD", assetType: "character", displayName: "토리 웃는 얼굴", parentFolderId: "ASSET-CHAR-FOLDER" });
const OFF = makeAssetFolder({ assetId: "ASSET-CHAR-OFF", assetType: "character", displayName: "꺼 둔 폴더", enabled: false });
const NEW_FOLDER = makeAssetFolder({ assetId: "ASSET-CHAR-NEW", assetType: "character", displayName: "새봄" });

function mockServer(routes: Record<string, unknown> = {}, errors: Record<string, { status: number; body: unknown }> = {}) {
  const fetchMock = stubFetchByRoute({ "GET /assets?assetType=character": { assets: [FOLDER, CHILD, OFF] }, ...routes }, errors);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map(([url, init]) => ({ method: (init as RequestInit | undefined)?.method ?? "GET", url: String(url), body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : undefined }))
    .filter((call) => call.method !== "GET");

function renderReview(props: { response?: ApproveNovelStoryAnalysisResponse; stale?: boolean } = {}) {
  const onCreated = vi.fn();
  render(<StoryAnalysisReview response={props.response ?? response()} stale={props.stale ?? false} onCreated={onCreated} onOpenSettings={() => {}} />);
  return { onCreated };
}

const change = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("normalizeProtagonist", () => {
  const cast = (...roles: ("protagonist" | "supporting")[]) => roles.map((role, index) => ({ id: `c${index}`, role }));
  it("keeps exactly one protagonist whatever the AI returned", () => {
    expect(normalizeProtagonist(cast("supporting", "supporting")).map((item) => item.role)).toEqual(["protagonist", "supporting"]);
    expect(normalizeProtagonist(cast("supporting", "protagonist", "protagonist")).map((item) => item.role)).toEqual(["supporting", "protagonist", "supporting"]);
    expect(normalizeProtagonist(cast("protagonist", "supporting")).map((item) => item.role)).toEqual(["protagonist", "supporting"]);
    expect(normalizeProtagonist([])).toEqual([]);
  });
});

describe("StoryAnalysisReview (M2)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows every analysed field as an editable value", async () => {
    mockServer();
    renderReview();
    expect((screen.getByTestId("review-title") as HTMLInputElement).value).toBe("달빛 문");
    expect((screen.getByTestId("review-logline") as HTMLTextAreaElement).value).toBe("낯선 문 뒤의 세계");
    expect((screen.getByTestId("review-genre") as HTMLInputElement).value).toBe("판타지");
    expect((screen.getByTestId("review-character-name-1") as HTMLInputElement).value).toBe("문지기");
    expect((screen.getByTestId("review-episode-title-2") as HTMLInputElement).value).toBe("문 너머");
    expect(screen.getByTestId("review-episode-count").textContent).toContain("2 / 20회");
    expect(screen.getByTestId("story-result-source").textContent).toContain("출처 메모: 직접 쓴 글");
    await waitFor(() => expect(screen.getByTestId("review-protagonist-asset")).toBeTruthy());
  });

  /** 🔴 확정은 저장 요청 하나뿐 — 본문·분석·미리보기·Provider 요청은 없고, 서버로 가는 건 구조와 M1 출처 메타데이터다. */
  it("creates the project with one request carrying the edited structure and the untouched source metadata", async () => {
    const project = makeLongProject();
    const fetchMock = mockServer({ [CREATE]: { project } });
    const { onCreated } = renderReview();

    change("review-title", "  달빛 아래의 문  ");
    change("review-episode-summary-1", "새봄이 낯선 문 앞에 선다.");
    change("review-character-appearance-1", "회색 망토에 가려진 얼굴");
    fireEvent.click(screen.getByTestId("review-create"));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    const calls = posts(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/long-projects/from-story-analysis");
    const body = calls[0]!.body;
    expect(Object.keys(body).sort()).toEqual(["analysis", "projectId", "settings", "source"]);
    expect(body.projectId).toMatch(/^이야기_달빛_아래의_문_\d{4}_\d{6}$/);
    expect(body.source).toEqual(response().source);
    expect(body.analysis.title).toBe("달빛 아래의 문");
    expect(body.analysis.episodes.map((episode: { episodeNumber: number }) => episode.episodeNumber)).toEqual([1, 2]);
    expect(body.analysis.episodes[0].summary).toBe("새봄이 낯선 문 앞에 선다.");
    expect(body.analysis.characters[1]).toEqual({ id: "c2", name: "문지기", role: "supporting", appearance: "회색 망토에 가려진 얼굴", personality: "수수께끼 같다" });
    expect(body.analysis.warnings).toEqual(response().analysis.warnings);
    // 서버는 settings 의 다섯 분석 필드가 analysis 와 같은지, 회차 수가 배열 길이와 같은지 본다.
    expect(body.settings).toMatchObject({ title: "달빛 아래의 문", logline: "낯선 문 뒤의 세계", genre: "판타지", tone: "몽환적", theme: "용기", overview: "낯선 문 뒤의 세계", episodeCount: 2, sceneCount: 7, aspectRatio: "9:16" });
    // 출처 메모는 source 에만 있고 대본 프롬프트로 가는 settings.notes 에는 들어가지 않는다(CLI 1317).
    expect(body.settings.notes).toBe("");
    expect(body.source.sourceNote).toBe("직접 쓴 글");
    expect(JSON.stringify(body.settings)).not.toContain("직접 쓴 글");
    expect(body.settings.episodeDurationSeconds).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("sourceText");
    expect("protagonistAssetId" in body).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => /^\/story-analysis(\/preview)?$|generation|openai|runway/i.test(String(url)))).toBe(false);
  });

  it("keeps exactly one protagonist, lets the person change who, and will not remove the lead", async () => {
    const fetchMock = mockServer({ [CREATE]: { project: makeLongProject() } });
    renderReview();
    expect((screen.getByTestId("review-remove-character-0") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("review-protagonist-1"));
    expect((screen.getByTestId("review-protagonist-0") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("review-protagonist-1") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("review-remove-character-0") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("review-remove-character-1") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("review-create"));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const roles = posts(fetchMock)[0]!.body.analysis.characters.map((character: { role: string }) => character.role);
    expect(roles).toEqual(["supporting", "protagonist"]);
  });

  it("adds and removes characters, with a new empty one blocking the confirm until it is filled", async () => {
    const fetchMock = mockServer({ [CREATE]: { project: makeLongProject() } });
    renderReview();
    fireEvent.click(screen.getByTestId("review-add-character"));
    expect(screen.getByTestId("review-character-count").textContent).toContain("3 / 40");
    expect((screen.getByTestId("review-create") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("review-empty-summary").textContent).toContain("3개");
    change("review-character-name-2", "행인");
    change("review-character-appearance-2", "우산을 든 사람");
    change("review-character-personality-2", "말이 없다");
    expect((screen.getByTestId("review-create") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("review-create"));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const ids = posts(fetchMock)[0]!.body.analysis.characters.map((character: { id: string }) => character.id);
    expect(ids).toEqual(["c1", "c2", "char-3"]);
  });

  it("reorders, adds and removes episodes, renumbers them 1..n, and keeps the limits", async () => {
    const fetchMock = mockServer({ [CREATE]: { project: makeLongProject() } });
    renderReview();
    fireEvent.click(screen.getByTestId("review-episode-down-1"));
    expect((screen.getByTestId("review-episode-title-1") as HTMLInputElement).value).toBe("문 너머");
    expect((screen.getByTestId("review-episode-title-2") as HTMLInputElement).value).toBe("첫 번째 꿈");
    expect((screen.getByTestId("review-episode-up-1") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("review-episode-down-2") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("review-episode-remove-1"));
    expect(screen.getByTestId("review-episode-count").textContent).toContain("1 / 20회");
    expect((screen.getByTestId("review-episode-remove-1") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("review-add-episode"));
    for (const [field, value] of [["title", "새 회차"], ["summary", "요약"], ["main", "사건"], ["conflict", "갈등"], ["cliff", "마지막"], ["hook", "다음"]] as const) {
      change(`review-episode-${field}-2`, value);
    }
    fireEvent.click(screen.getByTestId("review-create"));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const { analysis, settings } = posts(fetchMock)[0]!.body;
    expect(analysis.episodes.map((episode: { episodeNumber: number; title: string }) => `${episode.episodeNumber}:${episode.title}`)).toEqual(["1:첫 번째 꿈", "2:새 회차"]);
    expect(settings.episodeCount).toBe(2);
  });

  /** M3: 인물 이미지는 사람이 승인한 한 번뿐 — 화면 진입·프로젝트 확정만으로는 이미지 요청이 나가지 않는다. */
  it("never sends a character-image request on its own, not even when the project is confirmed", async () => {
    const fetchMock = mockServer({ [CREATE]: { project: makeLongProject() } });
    renderReview();
    expect(screen.getByTestId("character-image-preview-c1")).toBeTruthy();
    expect(screen.getByTestId("character-image-preview-c2")).toBeTruthy();
    fireEvent.click(screen.getByTestId("review-create"));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("character-image"))).toBe(false);
  });

  it("refreshes the library after a picture is made and links it as the lead only when the person chooses", async () => {
    const fetchMock = mockServer({
      "GET /assets?assetType=character": sequence([{ assets: [FOLDER, CHILD, OFF] }, { assets: [FOLDER, NEW_FOLDER, CHILD, OFF] }]),
      "POST /story-analysis/character-image/preview": {
        preview: { inputSha256: "c".repeat(64), promptSha256: "d".repeat(64), prompt: "프롬프트", model: "gpt-image-2", size: "1024x1536", estimatedCostUsd: 0.1, providerAvailable: true },
      },
      "POST /story-analysis/character-image": { folderAssetId: "ASSET-CHAR-NEW", imageAssetId: "ASSET-IMG-NEW", reused: false },
      [CREATE]: { project: makeLongProject() },
    });
    renderReview();
    const select = (await screen.findByTestId("review-protagonist-asset")) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "ASSET-CHAR-FOLDER"]);

    fireEvent.click(screen.getByTestId("character-image-preview-c1"));
    await screen.findByTestId("character-image-card-c1");
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    await screen.findByTestId("character-image-result-c1");
    await waitFor(() => expect(Array.from((screen.getByTestId("review-protagonist-asset") as HTMLSelectElement).options).map((option) => option.value)).toEqual(["", "ASSET-CHAR-FOLDER", "ASSET-CHAR-NEW"]));
    // 만들어졌다고 자동으로 연결되지 않는다.
    expect((screen.getByTestId("review-protagonist-asset") as HTMLSelectElement).value).toBe("");

    fireEvent.click(screen.getByTestId("character-image-use-c1"));
    expect((screen.getByTestId("review-protagonist-asset") as HTMLSelectElement).value).toBe("ASSET-CHAR-NEW");
    fireEvent.click(screen.getByTestId("review-create"));
    await waitFor(() => expect(posts(fetchMock).some((call) => call.url === "/long-projects/from-story-analysis")).toBe(true));
    expect(posts(fetchMock).find((call) => call.url === "/long-projects/from-story-analysis")!.body.protagonistAssetId).toBe("ASSET-CHAR-NEW");
  });

  /** CLI 1322: 연결해 둔 주인공 그림의 인물 설명을 바꾸면, 바뀌기 전 설명의 그림이라 연결이 풀린다. */
  it("drops the linked lead picture when that character's description is edited afterwards", async () => {
    mockServer({
      "GET /assets?assetType=character": { assets: [FOLDER, NEW_FOLDER] },
      "POST /story-analysis/character-image/preview": {
        preview: { inputSha256: "c".repeat(64), promptSha256: "d".repeat(64), prompt: "프롬프트", model: "gpt-image-2", size: "1024x1536", estimatedCostUsd: 0.1, providerAvailable: true },
      },
      "POST /story-analysis/character-image": { folderAssetId: "ASSET-CHAR-NEW", imageAssetId: "ASSET-IMG-NEW", reused: false },
    });
    renderReview();
    fireEvent.click(screen.getByTestId("character-image-preview-c1"));
    await screen.findByTestId("character-image-card-c1");
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    await screen.findByTestId("character-image-result-c1");
    fireEvent.click(screen.getByTestId("character-image-use-c1"));
    await waitFor(() => expect((screen.getByTestId("review-protagonist-asset") as HTMLSelectElement).value).toBe("ASSET-CHAR-NEW"));

    change("review-character-appearance-0", "다른 모습으로 고친 설명");
    expect((screen.getByTestId("review-protagonist-asset") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByTestId("character-image-use-c1")).toBeNull();
    expect(screen.getByTestId("character-image-old-c1")).toBeTruthy();
  });

  it("drops a picture linked for one lead when someone else becomes the lead", async () => {
    mockServer({
      "GET /assets?assetType=character": { assets: [FOLDER, NEW_FOLDER] },
      "POST /story-analysis/character-image/preview": {
        preview: { inputSha256: "c".repeat(64), promptSha256: "d".repeat(64), prompt: "프롬프트", model: "gpt-image-2", size: "1024x1536", estimatedCostUsd: 0.1, providerAvailable: true },
      },
      "POST /story-analysis/character-image": { folderAssetId: "ASSET-CHAR-NEW", imageAssetId: "ASSET-IMG-NEW", reused: false },
    });
    renderReview();
    fireEvent.click(screen.getByTestId("character-image-preview-c1"));
    await screen.findByTestId("character-image-card-c1");
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    await screen.findByTestId("character-image-result-c1");
    fireEvent.click(screen.getByTestId("character-image-use-c1"));
    await waitFor(() => expect((screen.getByTestId("review-protagonist-asset") as HTMLSelectElement).value).toBe("ASSET-CHAR-NEW"));

    fireEvent.click(screen.getByTestId("review-protagonist-1"));
    expect((screen.getByTestId("review-protagonist-asset") as HTMLSelectElement).value).toBe("");
  });

  it("stops adding episodes at the shared maximum", () => {
    mockServer();
    renderReview();
    for (let index = 0; index < REVIEW_LIMITS.episodesMax; index += 1) fireEvent.click(screen.getByTestId("review-add-episode"));
    expect(screen.getByTestId("review-episode-count").textContent).toContain("20 / 20회");
    expect((screen.getByTestId("review-add-episode") as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks the confirm while a required field is empty and says how many", () => {
    mockServer();
    renderReview();
    change("review-title", "   ");
    change("review-episode-conflict-2", "");
    expect(screen.getByTestId("review-title-empty").textContent).toContain("비워 둘 수 없습니다");
    expect(screen.getByTestId("review-empty-summary").textContent).toContain("2개");
    expect((screen.getByTestId("review-create") as HTMLButtonElement).disabled).toBe(true);
    change("review-title", "고친 제목");
    change("review-episode-conflict-2", "갈등");
    expect(screen.queryByTestId("review-empty-summary")).toBeNull();
    expect((screen.getByTestId("review-create") as HTMLButtonElement).disabled).toBe(false);
  });

  it("holds every field to the server's character limit", () => {
    mockServer();
    renderReview();
    expect((screen.getByTestId("review-title") as HTMLInputElement).maxLength).toBe(120);
    expect((screen.getByTestId("review-logline") as HTMLTextAreaElement).maxLength).toBe(800);
    expect((screen.getByTestId("review-character-name-0") as HTMLInputElement).maxLength).toBe(80);
    expect((screen.getByTestId("review-episode-summary-1") as HTMLTextAreaElement).maxLength).toBe(1200);
    expect((screen.getByTestId("review-episode-cliff-1") as HTMLTextAreaElement).maxLength).toBe(500);
  });

  it("will not create from a result whose input has changed since", () => {
    const fetchMock = mockServer();
    renderReview({ stale: true });
    expect(screen.getByTestId("story-result-stale").textContent).toContain("확정할 수 없습니다");
    expect((screen.getByTestId("review-create") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("review-create"));
    expect(posts(fetchMock)).toEqual([]);
  });

  it("offers only enabled character folders and sends the chosen one as protagonistAssetId", async () => {
    const fetchMock = mockServer({ [CREATE]: { project: makeLongProject() } });
    renderReview();
    const select = (await screen.findByTestId("review-protagonist-asset")) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "ASSET-CHAR-FOLDER"]);
    fireEvent.change(select, { target: { value: "ASSET-CHAR-FOLDER" } });
    fireEvent.click(screen.getByTestId("review-create"));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body.protagonistAssetId).toBe("ASSET-CHAR-FOLDER");
  });

  it("says so when the library has no folder or cannot be read, and still creates", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ "GET /assets?assetType=character": { assets: [CHILD] } }));
    const first = render(<StoryAnalysisReview response={response()} stale={false} onCreated={() => {}} onOpenSettings={() => {}} />);
    expect((await screen.findByTestId("review-library-empty")).textContent).toContain("캐릭터 폴더가 보관함에 없습니다");
    first.unmount();

    vi.stubGlobal("fetch", stubFetchByRoute({}, { "GET /assets?assetType=character": { status: 500, body: { code: "X", message: "boom" } } }));
    render(<StoryAnalysisReview response={response()} stale={false} onCreated={() => {}} onOpenSettings={() => {}} />);
    await waitFor(() => expect(screen.getByText(/목록을 불러오지 못했습니다/)).toBeTruthy());
    expect((screen.getByTestId("review-create") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a fixed sentence — never the server's — and keeps the edits when creation fails", async () => {
    mockServer({}, { [CREATE]: { status: 409, body: { code: "LONG_PROJECT_ALREADY_EXISTS", message: "raw server text" } } });
    const { onCreated } = renderReview();
    change("review-title", "내가 고친 제목");
    fireEvent.click(screen.getByTestId("review-create"));
    const alert = await screen.findByTestId("review-create-error");
    expect(alert.getAttribute("data-error-code")).toBe("LONG_PROJECT_ALREADY_EXISTS");
    expect(alert.textContent).not.toContain("raw server text");
    expect(alert.textContent).not.toBe("");
    expect(onCreated).not.toHaveBeenCalled();
    expect((screen.getByTestId("review-title") as HTMLInputElement).value).toBe("내가 고친 제목");
    expect((screen.getByTestId("review-create") as HTMLButtonElement).disabled).toBe(false);
  });
});
