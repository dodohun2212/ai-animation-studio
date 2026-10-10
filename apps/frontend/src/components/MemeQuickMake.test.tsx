import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemeTrend, MemeTrendVideo, MemeTrendWorkspace } from "@ai-animation-studio/shared";
import { castMember, makeAsset, makeAssetFolder, makeProject, sequence, stubFetchByRoute, withStatus } from "../api/testUtils.js";
import { MemeQuickMake, autoProjectId, pickableCharacters } from "./MemeQuickMake.js";

const NOW = "2026-10-09T00:00:00.000Z";

function video(overrides: Partial<MemeTrendVideo>): MemeTrendVideo {
  return { videoId: "top", url: "https://www.youtube.com/watch?v=top", title: "니코니코니 챌린지", channelId: "c1", channelTitle: "채널", publishedAt: NOW, thumbnailUrl: null, viewCount: 1000, viewCountObservedAt: NOW, ...overrides };
}

const TREND: MemeTrend = {
  id: "niko",
  name: "#니코니코니",
  evidence: [{ kind: "hashtag", text: "#니코니코니", videoCount: 3 }],
  videos: [video({ videoId: "small", viewCount: 10, channelId: "c2" }), video({ videoId: "top", viewCount: 9000 }), video({ videoId: "mid", viewCount: 500, channelId: "c3" })],
  channelCount: 3,
  firstObservedAt: NOW,
  lastObservedAt: NOW,
};

const SUGGESTIONS = [
  { id: "s1", kind: "line" as const, text: "니코니코니~ 하고 외친다", startSeconds: 1, endSeconds: 2.5 },
  { id: "s2", kind: "gesture" as const, text: "양손으로 하트", startSeconds: null, endSeconds: null },
];

function workspace(overrides: Partial<MemeTrendWorkspace> = {}): MemeTrendWorkspace {
  return { trendId: "niko", analyses: [], cards: [], cardsSavedAt: null, dailyCalls: { used: 0, limit: 3 }, ...overrides };
}

const ANALYSIS_TOP = { sourceVideoId: "top", provider: "gemini" as const, analyzedAt: NOW, model: "gemini-test", suggestions: SUGGESTIONS };
const analyzed = workspace({ analyses: [ANALYSIS_TOP], dailyCalls: { used: 1, limit: 3 } });
const savedCards = workspace({
  analyses: [ANALYSIS_TOP],
  cardsSavedAt: NOW,
  cards: SUGGESTIONS.map((suggestion) => ({ id: `card-${suggestion.id}`, kind: suggestion.kind, text: suggestion.text, startSeconds: suggestion.startSeconds, endSeconds: suggestion.endSeconds, origin: "suggestion" as const, suggestionId: suggestion.id, sourceVideoId: "top" })),
  dailyCalls: { used: 1, limit: 3 },
});

const FOLDER = makeAssetFolder({ assetId: "ASSET-CHAR-FOLDER", assetType: "character", displayName: "토리", childAssetIds: ["ASSET-CHAR-CHILD"], thumbnailAssetId: "ASSET-CHAR-CHILD" });
const SOLO = makeAsset({ assetId: "ASSET-CHAR-SOLO", assetType: "character", displayName: "미니", parentFolderId: "" });
const CHILD = makeAsset({ assetId: "ASSET-CHAR-CHILD", assetType: "character", displayName: "토리 웃는 얼굴", parentFolderId: "ASSET-CHAR-FOLDER" });
const OFF = makeAsset({ assetId: "ASSET-CHAR-OFF", assetType: "character", displayName: "꺼 둔 캐릭터", parentFolderId: "", enabled: false });
const ASSETS = { assets: [FOLDER, SOLO, CHILD, OFF] };

const WS = "GET /trends/memes/niko/workspace";

function mockServer(routes: Record<string, unknown>, errorRoutes: Record<string, { status: number; body: unknown }> = {}) {
  const fetchMock = stubFetchByRoute({ "GET /assets?assetType=character": ASSETS, ...routes }, errorRoutes);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const requests = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(url)}`);
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, key: string): any => {
  const hit = fetchMock.mock.calls.find(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(url)}` === key || (key.startsWith("POST /projects") && String(url) === "/projects" && (init as RequestInit | undefined)?.method === "POST"));
  return hit ? JSON.parse(String((hit[1] as RequestInit).body)) : undefined;
};

function renderQuick() {
  const onProjectCreated = vi.fn();
  const onOpenCards = vi.fn();
  const view = render(<MemeQuickMake trend={TREND} onProjectCreated={onProjectCreated} onOpenCards={onOpenCards} />);
  const rerenderWith = (cardsSavedAt: string | null) =>
    view.rerender(<MemeQuickMake trend={TREND} onProjectCreated={onProjectCreated} onOpenCards={onOpenCards} cardsSavedAt={cardsSavedAt} />);
  return { onProjectCreated, onOpenCards, rerenderWith };
}

async function chooseCharacter(assetId = "ASSET-CHAR-FOLDER") {
  fireEvent.click(await screen.findByTestId(`meme-quick-character-${assetId}`));
}

describe("autoProjectId / pickableCharacters", () => {
  it("makes a folder-safe name without asking a person", () => {
    const id = autoProjectId("#니코니코니", new Date(2026, 9, 9, 14, 5, 7));
    expect(id).toBe("밈_니코니코니_1009_140507");
    expect(/^[\p{L}\p{N}_-]+$/u.test(id)).toBe(true);
    expect(autoProjectId("!!!", new Date(2026, 0, 1, 0, 0, 0))).toBe("밈_meme_0101_000000");
  });

  it("offers folders and loose characters, not folder children or disabled ones", () => {
    expect(pickableCharacters(ASSETS.assets).map((asset) => asset.assetId)).toEqual(["ASSET-CHAR-FOLDER", "ASSET-CHAR-SOLO"]);
  });
});

describe("MemeQuickMake", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("lists library characters and keeps the button off until one is chosen and saved cards exist", async () => {
    mockServer({ [WS]: savedCards });
    renderQuick();
    await screen.findByTestId("meme-quick-characters");
    expect(screen.queryByTestId("meme-quick-character-ASSET-CHAR-CHILD")).toBeNull();
    expect(screen.queryByTestId("meme-quick-character-ASSET-CHAR-OFF")).toBeNull();
    await waitFor(() => expect((screen.getByTestId("meme-quick-plan").textContent ?? "")).toContain("저장한 관찰 카드 2장으로 만듭니다"));
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    await chooseCharacter();
    expect(screen.getByTestId("meme-quick-character-ASSET-CHAR-FOLDER").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("meme-quick-run").textContent).toBe("이 밈으로 만들기");
  });

  /** 🔴 CLI 1340: 저장된 카드로 프로젝트 → 주인공 연결, 이 순서로만. 분석·카드 저장·OpenAI·Runway 요청은 없다. */
  it("creates the project from the saved cards only and links the character as lead, without analysing or saving cards", async () => {
    const project = makeProject({ id: "created_project" });
    const fetchMock = mockServer({
      [WS]: savedCards,
      "POST /projects": { project },
      "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-FOLDER", { representative: true })] },
    });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("meme-quick-run"));

    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(project));
    const sent = requests(fetchMock).filter((entry) => !entry.startsWith("GET"));
    expect(sent).toEqual([
      "POST /projects",
      "PUT /projects/created_project/settings/cast",
    ]);
    expect(screen.queryByTestId("meme-quick-video")).toBeNull();
    const created = bodyOf(fetchMock, "POST /projects");
    expect(created.projectId).toMatch(/^밈_니코니코니_\d{4}_\d{6}$/);
    expect(created.initialStoryDraft.character).toBe("토리");
    expect(created.initialStoryDraft.sceneCount).toBe(4);
    expect(created.initialStoryDraft.additionalNotes).toContain("말: 니코니코니~ 하고 외친다");
    expect(created.initialStoryDraft.additionalNotes).toContain("복제하지 마세요");
    expect(bodyOf(fetchMock, "PUT /projects/created_project/settings/cast")).toEqual({ cast: [{ assetId: "ASSET-CHAR-FOLDER", castRole: "protagonist", storyRole: "주인공" }] });
    expect(requests(fetchMock).some((entry) => /generation|runway|openai/i.test(entry))).toBe(false);
  });

  /** 예전의 「대표 영상 1편 자동 분석」은 없다 — 영상 선택도 분석 호출도 여기엔 없고, 고르기는 관찰 카드 칸에서 한다. */
  it("has no video picker and no analysis call, and sends the person to the observation cards instead", async () => {
    const fetchMock = mockServer({ [WS]: workspace() });
    const { onOpenCards } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("아직 저장한 관찰 카드가 없습니다"));
    expect(screen.queryByTestId("meme-quick-video")).toBeNull();
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("meme-quick-open-cards"));
    expect(onOpenCards).toHaveBeenCalledTimes(1);
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);
  });

  it("reuses already saved cards instead of spending another analysis", async () => {
    const project = makeProject({ id: "reuse_project" });
    const fetchMock = mockServer({ [WS]: savedCards, "POST /projects": { project }, "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-SOLO", { representative: true })] } });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter("ASSET-CHAR-SOLO");
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("저장한 관찰 카드 2장"));
    expect(screen.getByTestId("meme-quick-run").textContent).toBe("이 밈으로 만들기");
    expect(screen.queryByTestId("meme-quick-open-cards")).toBeNull();
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(project));
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);
  });

  it("without saved cards, creates only when the person chooses to go on without analysis", async () => {
    const project = makeProject({ id: "plain_project" });
    const fetchMock = mockServer({ [WS]: workspace({ dailyCalls: { used: 3, limit: 3 } }), "POST /projects": { project }, "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-FOLDER", { representative: true })] } });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("아직 저장한 관찰 카드가 없습니다"));
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("meme-quick-skip"));
    await waitFor(() => expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("meme-quick-plan").textContent).toContain("분석 없이 만듭니다");
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(project));
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);
    expect(bodyOf(fetchMock, "POST /projects").initialStoryDraft.sceneCount).toBe(2);
  });

  it("does not call analysis when the usage record cannot be read, and still needs saved cards", async () => {
    const fetchMock = mockServer({ [WS]: workspace({ dailyCalls: null }) });
    renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("아직 저장한 관찰 카드가 없습니다"));
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);
  });

  /** 저장본을 못 읽으면 무엇으로 만들지 모르므로 만들지 않는다 — 이 화면은 Gemini 를 부르지 않으니 키 없음으로 막히지도 않는다. */
  it("does not create anything when the saved cards cannot be read", async () => {
    const fetchMock = mockServer({}, { [WS]: { status: 500, body: { code: "MEME_WORKSPACE_STORE_UNREADABLE", message: "raw" } } });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("읽지 못했습니다"));
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("meme-quick-skip")).toBeNull();
    expect(onProjectCreated).not.toHaveBeenCalled();
    expect(requests(fetchMock).some((entry) => entry === "POST /projects" || entry.includes("/analysis"))).toBe(false);
  });

  /** 🔴 Codex 1304-②: 연결 실패 때 바로 이동하면 이 화면이 사라져 알림을 못 본다 — 이동하지 않고 여기서 알린다. */
  it("stays on the screen when linking the lead fails, then links again or opens the project without it", async () => {
    const project = makeProject({ id: "half_project" });
    const fetchMock = mockServer({
      [WS]: savedCards,
      "POST /projects": { project },
      "PUT /settings/cast": sequence([withStatus(500, { code: "X", message: "boom" }), { cast: [castMember("ASSET-CHAR-FOLDER", { representative: true })] }]),
    });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("meme-quick-run"));

    const alert = await screen.findByTestId("meme-quick-error");
    expect(alert.getAttribute("data-error-code")).toBe("CAST_LINK_FAILED");
    expect(alert.textContent).toContain("이미 만들어져 있습니다");
    expect(onProjectCreated).not.toHaveBeenCalled();
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("meme-quick-retry-link"));
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(project));
    expect(requests(fetchMock).filter((entry) => entry === "POST /projects")).toHaveLength(1);
  });

  it("lets the person open the project without the character when linking keeps failing", async () => {
    const project = makeProject({ id: "no_lead_project" });
    mockServer({ [WS]: savedCards, "POST /projects": { project } }, { "PUT /settings/cast": { status: 500, body: { code: "X", message: "boom" } } });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await screen.findByTestId("meme-quick-open-project");
    expect(onProjectCreated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("meme-quick-open-project"));
    expect(onProjectCreated).toHaveBeenCalledWith(project);
  });

  /** 🔴 CLI 1340: 저장된 분석 제안은 사람이 고르기 전까지 카드가 아니다 — 여기서 저절로 카드로 저장하지 않는다. */
  it("does not turn stored suggestions into cards on its own", async () => {
    const fetchMock = mockServer({ [WS]: analyzed });
    renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("분석한 영상 1편의 제안 2개"));
    expect(screen.getByTestId("meme-quick-plan").textContent).toContain("쓸 제안만 가져와 저장");
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    expect(requests(fetchMock).filter((entry) => !entry.startsWith("GET"))).toEqual([]);
  });

  /** 관찰 카드 칸이 새 저장 시각을 알리면 저장본을 다시 읽고(GET), 그 카드로 만든다. 같은 시각이면 다시 읽지 않는다. */
  it("re-reads the saved cards when the observation cards report a new save, then creates from them", async () => {
    const project = makeProject({ id: "after_save_project" });
    const fetchMock = mockServer({
      [WS]: sequence([analyzed, savedCards]),
      "POST /projects": { project },
      "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-FOLDER", { representative: true })] },
    });
    const { onProjectCreated, rerenderWith } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("제안 2개"));
    rerenderWith(null);
    expect(requests(fetchMock).filter((entry) => entry === WS)).toHaveLength(1);
    rerenderWith(NOW);
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("저장한 관찰 카드 2장"));
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(project));
    expect(requests(fetchMock).filter((entry) => entry === WS)).toHaveLength(2);
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis") || entry.includes("/cards"))).toBe(false);
  });

  /** 제안 0개였던 분석도 여기서 다시 분석하지 않는다 — 다시 분석은 관찰 카드 칸에서 한 편씩 직접. */
  it("offers no re-analysis here for a stored analysis that found nothing", async () => {
    const empty = workspace({ analyses: [{ ...ANALYSIS_TOP, suggestions: [] }], dailyCalls: { used: 1, limit: 3 } });
    const fetchMock = mockServer({ [WS]: empty });
    renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("아직 저장한 관찰 카드가 없습니다"));
    expect(screen.queryByTestId("meme-quick-reanalyze")).toBeNull();
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("meme-quick-skip")).toBeTruthy();
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);
  });

  it("says so when the library has no usable character", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ [WS]: workspace(), "GET /assets?assetType=character": { assets: [] } }));
    renderQuick();
    expect((await screen.findByTestId("meme-quick-characters-empty")).textContent).toContain("캐릭터를 먼저 등록");
  });
});
