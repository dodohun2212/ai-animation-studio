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
  return { trendId: "niko", analysis: null, cards: [], cardsSavedAt: null, dailyCalls: { used: 0, limit: 3 }, ...overrides };
}

const analyzed = workspace({
  analysis: { sourceVideoId: "top", provider: "gemini" as const, analyzedAt: NOW, model: "gemini-test", suggestions: SUGGESTIONS },
  dailyCalls: { used: 1, limit: 3 },
});
const savedCards = workspace({
  analysis: analyzed.analysis,
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
const ANALYSIS = "POST /trends/memes/niko/analysis";
const CARDS = "PUT /trends/memes/niko/cards";

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
  const onOpenSettings = vi.fn();
  render(<MemeQuickMake trend={TREND} onOpenSettings={onOpenSettings} onProjectCreated={onProjectCreated} />);
  return { onProjectCreated, onOpenSettings };
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

  it("lists library characters and keeps the button off until one is chosen", async () => {
    mockServer({ [WS]: workspace() });
    renderQuick();
    await screen.findByTestId("meme-quick-characters");
    expect(screen.queryByTestId("meme-quick-character-ASSET-CHAR-CHILD")).toBeNull();
    expect(screen.queryByTestId("meme-quick-character-ASSET-CHAR-OFF")).toBeNull();
    await waitFor(() => expect((screen.getByTestId("meme-quick-plan").textContent ?? "")).toContain("Gemini로 분석합니다"));
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    await chooseCharacter();
    expect(screen.getByTestId("meme-quick-character-ASSET-CHAR-FOLDER").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("meme-quick-run").textContent).toContain("분석 1회 사용");
  });

  /** 🔴 분석 → 카드 저장 → 프로젝트 → 주인공 연결, 이 순서로만. OpenAI·Runway 로 가는 요청은 없다. */
  it("analyses the top video, saves the cards, creates the project and links the character as lead", async () => {
    const project = makeProject({ id: "created_project" });
    const fetchMock = mockServer({
      [WS]: workspace(),
      [ANALYSIS]: analyzed,
      [CARDS]: savedCards,
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
      "POST /trends/memes/niko/analysis",
      "PUT /trends/memes/niko/cards",
      "POST /projects",
      "PUT /projects/created_project/settings/cast",
    ]);
    expect(bodyOf(fetchMock, ANALYSIS)).toEqual({ sourceVideoId: "top" });
    expect(screen.queryByTestId("meme-quick-video")).toBeNull();
    const cards = bodyOf(fetchMock, CARDS);
    expect(cards.cards).toHaveLength(2);
    expect(cards.cards[0]).toMatchObject({ kind: "line", origin: "suggestion", suggestionId: "s1", sourceVideoId: "top" });
    const created = bodyOf(fetchMock, "POST /projects");
    expect(created.projectId).toMatch(/^밈_니코니코니_\d{4}_\d{6}$/);
    expect(created.initialStoryDraft.character).toBe("토리");
    expect(created.initialStoryDraft.sceneCount).toBe(4);
    expect(created.initialStoryDraft.additionalNotes).toContain("말: 니코니코니~ 하고 외친다");
    expect(created.initialStoryDraft.additionalNotes).toContain("복제하지 마세요");
    expect(bodyOf(fetchMock, "PUT /projects/created_project/settings/cast")).toEqual({ cast: [{ assetId: "ASSET-CHAR-FOLDER", castRole: "protagonist", storyRole: "주인공" }] });
    expect(requests(fetchMock).some((entry) => /generation|runway|openai/i.test(entry))).toBe(false);
  });

  /** 14편 전부가 아니라 한 편 — 기본은 조회수가 가장 큰 영상이고, 바꿀 수 있고, 화면이 그렇게 말한다. */
  it("analyses exactly one video, defaulting to the most viewed, and lets the person pick another", async () => {
    const project = makeProject({ id: "pick_project" });
    const fetchMock = mockServer({
      [WS]: workspace(),
      [ANALYSIS]: analyzed,
      [CARDS]: savedCards,
      "POST /projects": { project },
      "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-FOLDER", { representative: true })] },
    });
    renderQuick();
    await chooseCharacter();
    const select = (await screen.findByTestId("meme-quick-video")) as HTMLSelectElement;
    expect(select.value).toBe("top");
    expect(screen.getByTestId("meme-quick-plan").textContent).toContain("3편 전부가 아닙니다");
    fireEvent.change(select, { target: { value: "mid" } });
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await waitFor(() => expect(requests(fetchMock)).toContain("POST /projects"));
    expect(requests(fetchMock).filter((entry) => entry.includes("/analysis"))).toHaveLength(1);
    expect(bodyOf(fetchMock, ANALYSIS)).toEqual({ sourceVideoId: "mid" });
  });

  it("reuses already saved cards instead of spending another analysis", async () => {
    const project = makeProject({ id: "reuse_project" });
    const fetchMock = mockServer({ [WS]: savedCards, "POST /projects": { project }, "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-SOLO", { representative: true })] } });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter("ASSET-CHAR-SOLO");
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("이미 저장한 관찰 카드 2장"));
    expect(screen.getByTestId("meme-quick-run").textContent).toBe("이 밈으로 만들기");
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(project));
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);
  });

  it("blocks when today's analysis is used up, and lets the person go on without analysis", async () => {
    const project = makeProject({ id: "plain_project" });
    const fetchMock = mockServer({ [WS]: workspace({ dailyCalls: { used: 3, limit: 3 } }), "POST /projects": { project }, "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-FOLDER", { representative: true })] } });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("다 썼습니다"));
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("meme-quick-skip"));
    await waitFor(() => expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(project));
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);
    expect(bodyOf(fetchMock, "POST /projects").initialStoryDraft.sceneCount).toBe(2);
  });

  it("does not call analysis when the usage record cannot be read", async () => {
    const fetchMock = mockServer({ [WS]: workspace({ dailyCalls: null }) });
    renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("오늘 쓴 분석 횟수를 모릅니다"));
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);
  });

  it("stops before creating anything when the Gemini key is missing, and offers settings", async () => {
    const fetchMock = mockServer(
      { [WS]: workspace() },
      { [ANALYSIS]: { status: 400, body: { code: "MEME_ANALYSIS_KEY_MISSING", message: "raw" } } },
    );
    const { onOpenSettings, onProjectCreated } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("meme-quick-run"));

    const alert = await screen.findByTestId("meme-quick-error");
    expect(alert.getAttribute("data-error-code")).toBe("MEME_ANALYSIS_KEY_MISSING");
    expect(alert.textContent).not.toContain("raw");
    fireEvent.click(screen.getByTestId("meme-quick-open-settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onProjectCreated).not.toHaveBeenCalled();
    expect(requests(fetchMock).some((entry) => entry === "POST /projects")).toBe(false);
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

  /** 🔴 Codex 1304-①: 서버가 분석을 먼저 저장해 두므로, 저장된 분석이 있으면 Gemini 를 다시 부르지 않고 카드 저장부터 잇는다. */
  it("reuses a stored analysis and goes straight to saving the cards", async () => {
    const project = makeProject({ id: "stored_project" });
    const fetchMock = mockServer({
      [WS]: analyzed,
      [CARDS]: savedCards,
      "POST /projects": { project },
      "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-FOLDER", { representative: true })] },
    });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("이미 분석한 제안 2개"));
    expect(screen.getByTestId("meme-quick-run").textContent).toBe("이 밈으로 만들기");
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(project));
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);
    expect(bodyOf(fetchMock, CARDS).cards).toHaveLength(2);
  });

  it("does not analyse twice when saving the cards fails once and the person presses again", async () => {
    const project = makeProject({ id: "retry_project" });
    const fetchMock = mockServer({
      [WS]: workspace(),
      [ANALYSIS]: analyzed,
      [CARDS]: sequence([withStatus(500, { code: "MEME_STORE_UNWRITABLE", message: "boom" }), savedCards]),
      "POST /projects": { project },
      "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-FOLDER", { representative: true })] },
    });
    const { onProjectCreated } = renderQuick();
    await chooseCharacter();
    await waitFor(() => expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await screen.findByTestId("meme-quick-error");
    expect(onProjectCreated).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("이미 분석한 제안 2개"));

    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(project));
    expect(requests(fetchMock).filter((entry) => entry.includes("/analysis"))).toHaveLength(1);
    expect(requests(fetchMock).filter((entry) => entry === "PUT /trends/memes/niko/cards")).toHaveLength(2);
  });

  /** 저장된 분석이 「제안 0개」면 자동으로 다시 부르지 않는다 — 다시 분석할지는 사람이 명시적으로 고른다. */
  it("asks before re-analysing a stored analysis that found nothing, and never calls it on its own", async () => {
    const empty = workspace({ analysis: { sourceVideoId: "top", provider: "gemini" as const, analyzedAt: NOW, model: "gemini-test", suggestions: [] }, dailyCalls: { used: 1, limit: 3 } });
    const project = makeProject({ id: "empty_project" });
    const fetchMock = mockServer({
      [WS]: empty,
      [ANALYSIS]: analyzed,
      [CARDS]: savedCards,
      "POST /projects": { project },
      "PUT /settings/cast": { cast: [castMember("ASSET-CHAR-FOLDER", { representative: true })] },
    });
    renderQuick();
    await chooseCharacter();
    await waitFor(() => expect(screen.getByTestId("meme-quick-plan").textContent).toContain("알아볼 만한 말·동작을 찾지 못했습니다"));
    expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(true);
    expect(requests(fetchMock).some((entry) => entry.includes("/analysis"))).toBe(false);

    fireEvent.click(screen.getByTestId("meme-quick-reanalyze"));
    await waitFor(() => expect((screen.getByTestId("meme-quick-run") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("meme-quick-run").textContent).toContain("분석 1회 사용");
    fireEvent.click(screen.getByTestId("meme-quick-run"));
    await waitFor(() => expect(requests(fetchMock)).toContain("POST /projects"));
    expect(requests(fetchMock).filter((entry) => entry.includes("/analysis"))).toHaveLength(1);
  });

  it("says so when the library has no usable character", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ [WS]: workspace(), "GET /assets?assetType=character": { assets: [] } }));
    renderQuick();
    expect((await screen.findByTestId("meme-quick-characters-empty")).textContent).toContain("캐릭터를 먼저 등록");
  });
});
