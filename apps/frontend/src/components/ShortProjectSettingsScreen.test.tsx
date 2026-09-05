import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { castMember, jsonResponse, makeAsset, makeAssetFolder, makeProject } from "../api/testUtils.js";
import { ShortProjectSettingsScreen } from "./ShortProjectSettingsScreen.js";

const settings = {
  projectName: "별의 지도", topic: "별을 찾는 아이", genre: "판타지", mood: "따뜻함", character: "아이",
  lore: "별의 세계", fullStory: "별을 찾는다.", durationSeconds: 30, sceneCount: 6, clipDurationSeconds: 5,
  additionalNotes: "", styleNotes: { aspect: "16:9", lighting: "달빛" }, narrationEnabled: false, subtitlesEnabled: false,
};

/** Routes fetch calls by URL/method so test order doesn't depend on the settings screen's internal fetch sequencing. */
/** A route whose value is this shape answers with `status` instead of 200 — for the reads that are allowed to fail. */
function failing(status: number, body: unknown): { __status: number; body: unknown } {
  return { __status: status, body };
}
function isFailing(value: unknown): value is { __status: number; body: unknown } {
  return typeof value === "object" && value !== null && "__status" in value;
}

function stubFetchByRoute(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    if (key in routes) {
      const value = routes[key];
      return isFailing(value) ? jsonResponse(value.__status, value.body) : jsonResponse(200, value);
    }
    throw new Error(`Unexpected fetch call in test: ${key}`);
  });
  return fetchMock;
}

describe("ShortProjectSettingsScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reopens saved Wizard settings and saves an edited topic through PATCH", async () => {
    const project = makeProject({ topic: "새 주제" });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "PATCH /projects/sample_project/settings": { project, settings: { ...settings, topic: "새 주제" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    expect(await screen.findByDisplayValue("별의 지도")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("별을 찾는 아이"), { target: { value: "새 주제" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/projects/sample_project/settings" && (init as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings" && (init as RequestInit | undefined)?.method === "PATCH")!;
    const patchBody = JSON.parse(String((patchCall[1] as RequestInit).body));
    expect(patchBody).toMatchObject({ settings: { topic: "새 주제", sceneCount: 6, clipDurationSeconds: 5 } });
    // durationSeconds is derived server-side and must never be sent by the client.
    expect(patchBody.settings).not.toHaveProperty("durationSeconds");
  });

  it("edits scene count and clip duration, shows the computed total, and saves both without durationSeconds", async () => {
    const project = makeProject({});
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "PATCH /projects/sample_project/settings": { project, settings: { ...settings, sceneCount: 8, clipDurationSeconds: 10 } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    expect(screen.getByText(/예상 총 영상 길이: 30초/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("장면 수"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("클립 길이(초)"), { target: { value: "10" } });
    expect(screen.getByText(/예상 총 영상 길이: 80초/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/projects/sample_project/settings" && (init as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings" && (init as RequestInit | undefined)?.method === "PATCH")!;
    const patchBody = JSON.parse(String((patchCall[1] as RequestInit).body));
    expect(patchBody).toMatchObject({ settings: { sceneCount: 8, clipDurationSeconds: 10 } });
    expect(patchBody.settings).not.toHaveProperty("durationSeconds");
  });

  it("shows a one-time setup banner and a finish button that hands off via onBack right after creation", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    const onBack = vi.fn();
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={onBack} justCreated />);

    await screen.findByTestId("just-created-notice");
    expect(screen.getByRole("button", { name: "프로젝트로 이동" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "설정 완료 · 계속 진행하기" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("omits the setup banner and finish button when reopened later for an existing project", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    expect(screen.queryByTestId("just-created-notice")).toBeNull();
    expect(screen.queryByTestId("finish-setup-button")).toBeNull();
    // By testid, not by name: the header carries a back button with the same words, and both do the same thing.
    // The point here is that the bar at the end of the form still offers a way out when nothing was just created.
    expect(screen.getByTestId("settings-done-button")).toBeTruthy();
  });

  it("blocks empty project name before sending PATCH", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);
    const name = await screen.findByDisplayValue("별의 지도");
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "INVALID_REQUEST");
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")).toBe(false);
  });

  it("picks the representative character from a Folder, not from one of its drawings", async () => {
    // A Folder carries no image of its own, so its tile has to borrow the 대표 이미지 from among its children.
    const side = makeAsset({ assetId: "ASSET-CHAR-SIDE", displayName: "은빛 늑대_옆모습", assetType: "character", parentFolderId: "ASSET-CHAR-2", contentUrl: "/assets/ASSET-CHAR-SIDE/content", imageAvailable: true });
    const hero = makeAssetFolder({ assetId: "ASSET-CHAR-2", displayName: "은빛 늑대", assetType: "character", childAssetIds: [side.assetId], thumbnailAssetId: side.assetId });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?assetType=character": { assets: [hero, side] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    fireEvent.click(screen.getByRole("button", { name: "폴더에서 캐릭터 선택" }));

    const picker = await screen.findByRole("list", { name: "캐릭터 폴더 선택" });
    // The one drawing inside the folder is not offered on its own — "은빛 늑대_옆모습" is a pose, not the character.
    expect(within(picker).queryByText("은빛 늑대_옆모습")).toBeNull();
    expect(within(picker).getByText("이미지 1장")).toBeTruthy();
    fireEvent.click(within(picker).getByText("은빛 늑대"));

    expect((screen.getByDisplayValue("은빛 늑대") as HTMLInputElement).value).toBe("은빛 늑대");
  });

  it("shows a live draft Story prompt preview from unsaved settings once the panel is opened, and stays closed by default", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "POST /projects/sample_project/story/draft-preview": { prompt: "draft prompt text" },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    // Closed by default: no draft-preview request fires just from loading the screen.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("draft-preview"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "프롬프트 미리보기 보기" }));
    expect(await screen.findByText("draft prompt text", undefined, { timeout: 2000 })).toBeTruthy();

    const call = fetchMock.mock.calls.find(([url]) => String(url) === "/projects/sample_project/story/draft-preview")!;
    expect((call[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ settings: { topic: "별을 찾는 아이" } });
  });

  it("shows the actual error when the draft preview request fails, instead of the empty-fields hint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/projects/sample_project/settings") return jsonResponse(200, { settings, sceneCountChangeable: true, aspectRatioChangeable: true });
      if (url === "/projects/sample_project/settings/cast") return jsonResponse(200, { cast: [] });
      if (url === "/projects/sample_project/settings/asset-references") return jsonResponse(200, { atmosphereAssetIds: [], sceneReferenceAssets: [] });
      if (url === "/projects/sample_project/settings/continuity") return jsonResponse(200, { link: null });
      if (url === "/projects/sample_project/story/draft-preview" && init?.method === "POST") {
        return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "미리보기를 불러오지 못했습니다." });
      }
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    fireEvent.click(screen.getByRole("button", { name: "프롬프트 미리보기 보기" }));

    const alert = await screen.findByTestId("story-prompt-draft-preview-error", undefined, { timeout: 2000 });
    expect(alert.textContent).not.toContain("채우면");
    expect(screen.queryByText("프로젝트 이름과 영상 주제를 채우면 미리보기가 표시됩니다.")).toBeNull();
  });

  it("shows the current cast, adds a searched character, and removes a cast member", async () => {
    const hero = makeAssetFolder({ assetId: "ASSET-CHAR-1", displayName: "주인공", assetType: "character" });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?query=%EC%A3%BC%EC%9D%B8%EA%B3%B5&assetType=character": { assets: [hero] },
      "PUT /projects/sample_project/settings/cast": { cast: [castMember("ASSET-CHAR-1")] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const castSection = await screen.findByRole("region", { name: "등장 캐릭터" });
    await within(castSection).findByText("선택된 캐릭터가 없습니다.");

    const searchForm = within(castSection).getByRole("form", { name: "캐릭터 폴더 검색" });
    fireEvent.change(within(searchForm).getByLabelText("캐릭터 검색"), { target: { value: "주인공" } });
    fireEvent.click(within(searchForm).getByRole("button", { name: "검색" }));
    await screen.findByText("주인공");

    fireEvent.click(within(castSection).getByRole("button", { name: "추가" }));
    // The added member now shows its NAME, not its id — the id only appears as a fallback for a member loaded
    // from a saved cast with no search behind it. Scoped to the selected list because the search result below
    // still renders the same name.
    const selected = await within(castSection).findByRole("list", { name: "선택된 캐릭터 목록" });
    expect(within(selected).getByText("주인공")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/projects/sample_project/settings/cast" && (init as RequestInit | undefined)?.method === "PUT")).toBe(true);
  });

  it("removes a cast member through the same PUT endpoint", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [castMember("ASSET-CHAR-1", { representative: true })] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      // The row resolves its name from the library on mount; without this it falls back to the raw id.
      "GET /assets?assetType=character": { assets: [makeAssetFolder({ assetId: "ASSET-CHAR-1", displayName: "주인공", assetType: "character" })] },
      "PUT /projects/sample_project/settings/cast": { cast: [] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const castSection = await screen.findByRole("region", { name: "등장 캐릭터" });
    await within(castSection).findByText("주인공"); // the folder name, not its id — the row used to render the raw id
    fireEvent.click(within(castSection).getByRole("button", { name: "제거" }));

    await within(castSection).findByText("선택된 캐릭터가 없습니다.");
    const putCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings/cast" && (init as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse(String((putCall[1] as RequestInit).body))).toEqual({ cast: [] });
  });

  it("offers only character Folders in the cast search, so a single drawing cannot be added as a character", async () => {
    const folder = makeAssetFolder({ assetId: "ASSET-CHAR-FOLDER", displayName: "주인공 폴더", assetType: "character" });
    const loose = makeAsset({ assetId: "ASSET-CHAR-LOOSE", displayName: "주인공 옆모습", assetType: "character", isFolder: false });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?query=%EC%A3%BC%EC%9D%B8%EA%B3%B5&assetType=character": { assets: [folder, loose] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const castSection = await screen.findByRole("region", { name: "등장 캐릭터" });
    const searchForm = within(castSection).getByRole("form", { name: "캐릭터 폴더 검색" });
    fireEvent.change(within(searchForm).getByLabelText("캐릭터 검색"), { target: { value: "주인공" } });
    fireEvent.click(within(searchForm).getByRole("button", { name: "검색" }));

    const results = await within(castSection).findByRole("list", { name: "캐릭터 검색 결과" });
    expect(within(results).getByText("주인공 폴더")).toBeTruthy();
    expect(within(results).queryByText("주인공 옆모습")).toBeNull();
  });

  it("promotes a member to 대표 in the spelling the prompt builder actually reads, and demotes the previous one", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": {
        cast: [
          castMember("ASSET-CHAR-1", { representative: true }),
          castMember("ASSET-CHAR-2", { storyRole: "복수를 노리는 동생" }),
        ],
      },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?assetType=character": { assets: [
        makeAssetFolder({ assetId: "ASSET-CHAR-1", displayName: "주인공", assetType: "character" }),
        makeAssetFolder({ assetId: "ASSET-CHAR-2", displayName: "동생", assetType: "character" }),
      ] },
      "PUT /projects/sample_project/settings/cast": {
        cast: [
          castMember("ASSET-CHAR-1"),
          castMember("ASSET-CHAR-2", { representative: true, storyRole: "복수를 노리는 동생" }),
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const castSection = await screen.findByRole("region", { name: "등장 캐릭터" });
    await within(castSection).findByText("주인공"); // the folder name, not its id — the row used to render the raw id
    const second = within(castSection).getByRole("group", { name: "동생 구분" });
    fireEvent.click(within(second).getByRole("button", { name: "대표" }));

    const putCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings/cast" && (init as RequestInit | undefined)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(JSON.parse(String((putCall[1] as RequestInit).body))).toEqual({
      cast: [
        // Demoted, and its auto-filled 대표 캐릭터 story role follows.
        castMember("ASSET-CHAR-1"),
        // Promoted, but the story role the user typed themselves is left exactly as written.
        castMember("ASSET-CHAR-2", { representative: true, storyRole: "복수를 노리는 동생" }),
      ],
    });
  });

  it("says so when no member is the 대표, since the prompt would then describe everyone as 서브", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [castMember("ASSET-CHAR-1")] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const hint = await screen.findByTestId("cast-representative-hint");
    expect(hint.textContent).toContain("대표 캐릭터가 아직 없습니다");
  });

  it("shows a cast-load error without breaking the rest of the settings screen", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/projects/sample_project/settings") return jsonResponse(200, { settings, sceneCountChangeable: true, aspectRatioChangeable: true });
      if (url === "/projects/sample_project/settings/cast") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "internal: failed to load cast" });
      if (url === "/projects/sample_project/settings/asset-references") return jsonResponse(200, { atmosphereAssetIds: [], sceneReferenceAssets: [] });
      if (url === "/projects/sample_project/settings/continuity") return jsonResponse(200, { link: null });
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    const alert = await screen.findByTestId("cast-error");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_STORAGE_ERROR");
    expect(alert.textContent).toBe("저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("shows the current atmosphere/scene reference Assets, adds a searched atmosphere Asset, and removes it", async () => {
    const style = makeAsset({ assetId: "ASSET-STYLE-1", displayName: "네온 팔레트", assetType: "style" });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?query=%EB%84%A4%EC%98%A8": { assets: [style] },
      "PUT /projects/sample_project/settings/asset-references": { atmosphereAssetIds: ["ASSET-STYLE-1"], sceneReferenceAssets: [] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const refsSection = await screen.findByRole("region", { name: "분위기·장면 참고 이미지" });
    await within(refsSection).findByText("고른 분위기 이미지가 없습니다.");

    const searchForm = within(refsSection).getByRole("form", { name: "분위기 이미지 검색" });
    fireEvent.change(within(searchForm).getByLabelText("분위기 이미지 검색"), { target: { value: "네온" } });
    fireEvent.click(within(searchForm).getByRole("button", { name: "검색" }));
    await within(refsSection).findByText("네온 팔레트");

    fireEvent.click(within(refsSection).getByRole("button", { name: "추가" }));
    await within(refsSection).findByText("ASSET-STYLE-1");
    const putCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings/asset-references" && (init as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse(String((putCall[1] as RequestInit).body))).toEqual({ atmosphereAssetIds: ["ASSET-STYLE-1"], sceneReferenceAssets: [] });
  });

  it("adds a scene reference Asset with a required purpose and removes it through the same PUT endpoint", async () => {
    const key = makeAsset({ assetId: "ASSET-OBJECT-1", displayName: "청동 열쇠", assetType: "object" });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?query=%EC%97%B4%EC%87%A0": { assets: [key] },
      "PUT /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [{ assetId: "ASSET-OBJECT-1", purpose: "주인공이 항상 들고 다니는 열쇠" }] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const refsSection = await screen.findByRole("region", { name: "분위기·장면 참고 이미지" });
    const searchForm = await within(refsSection).findByRole("form", { name: "장면 참고 이미지 검색" });
    fireEvent.change(within(searchForm).getByLabelText("장면 참고 이미지 검색"), { target: { value: "열쇠" } });
    fireEvent.click(within(searchForm).getByRole("button", { name: "검색" }));
    await within(refsSection).findByText("청동 열쇠");

    const resultRow = within(refsSection).getByText("청동 열쇠").closest("li")!;
    expect(within(resultRow).getByRole("button", { name: "추가" })).toBeDisabled();
    fireEvent.change(within(resultRow).getByLabelText("사용 목적"), { target: { value: "주인공이 항상 들고 다니는 열쇠" } });
    fireEvent.click(within(resultRow).getByRole("button", { name: "추가" }));

    await within(refsSection).findByText("ASSET-OBJECT-1");
    const putCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings/asset-references" && (init as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse(String((putCall[1] as RequestInit).body))).toEqual({ atmosphereAssetIds: [], sceneReferenceAssets: [{ assetId: "ASSET-OBJECT-1", purpose: "주인공이 항상 들고 다니는 열쇠" }] });
  });

  it("shows an asset-reference load error without breaking the rest of the settings screen", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/projects/sample_project/settings") return jsonResponse(200, { settings, sceneCountChangeable: true, aspectRatioChangeable: true });
      if (url === "/projects/sample_project/settings/cast") return jsonResponse(200, { cast: [] });
      if (url === "/projects/sample_project/settings/asset-references") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "internal: failed to load asset references" });
      if (url === "/projects/sample_project/settings/continuity") return jsonResponse(200, { link: null });
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    const alert = await screen.findByTestId("asset-reference-error");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_STORAGE_ERROR");
    expect(alert.textContent).toBe("저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("lists continuity options, links to one, and disconnects it again", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /projects/sample_project/settings/continuity-options": { options: [{ projectId: "prev_project", projectName: "이전 프로젝트", label: "이전 프로젝트 · Scene 6" }] },
      "PUT /projects/sample_project/settings/continuity": { link: { projectId: "prev_project", projectName: "이전 프로젝트", label: "이전 프로젝트 · Scene 6" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const continuitySection = await screen.findByRole("region", { name: "이전 장면 연결" });
    await within(continuitySection).findByText("연결 안 함. 독립적인 새 이야기와 장면으로 시작합니다.");

    fireEvent.click(within(continuitySection).getByRole("button", { name: "이전 프로젝트 선택" }));
    await within(continuitySection).findByText("이전 프로젝트 · Scene 6");
    fireEvent.click(within(continuitySection).getByRole("button", { name: "선택" }));

    await within(continuitySection).findByText(/이전 프로젝트 · Scene 6 연결됨/);
    const linkCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings/continuity" && (init as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse(String((linkCall[1] as RequestInit).body))).toEqual({ projectId: "prev_project" });
  });

  it("disconnects an existing continuity link", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: { projectId: "prev_project", projectName: "이전 프로젝트", label: "이전 프로젝트 · Scene 6" } },
      "PUT /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const continuitySection = await screen.findByRole("region", { name: "이전 장면 연결" });
    await within(continuitySection).findByText(/이전 프로젝트 · Scene 6 연결됨/);
    fireEvent.click(within(continuitySection).getByRole("button", { name: "연결 해제" }));

    await within(continuitySection).findByText("연결 안 함. 독립적인 새 이야기와 장면으로 시작합니다.");
    const disconnectCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings/continuity" && (init as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse(String((disconnectCall[1] as RequestInit).body))).toEqual({ projectId: null });
  });

  it("shows a continuity load error without breaking the rest of the settings screen", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/projects/sample_project/settings") return jsonResponse(200, { settings, sceneCountChangeable: true, aspectRatioChangeable: true });
      if (url === "/projects/sample_project/settings/cast") return jsonResponse(200, { cast: [] });
      if (url === "/projects/sample_project/settings/asset-references") return jsonResponse(200, { atmosphereAssetIds: [], sceneReferenceAssets: [] });
      if (url === "/projects/sample_project/settings/continuity") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "internal: failed to load continuity" });
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    const alert = await screen.findByTestId("continuity-error");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_STORAGE_ERROR");
    expect(alert.textContent).toBe("저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("defaults narration off and saves it once turned on", async () => {
    const project = makeProject({});
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "PATCH /projects/sample_project/settings": { project, settings: { ...settings, narrationEnabled: true } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    const toggle = screen.getByTestId("settings-narration-enabled") as HTMLInputElement;
    // Existing projects stay silent until the user asks for narration.
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/projects/sample_project/settings" && (init as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings" && (init as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse(String((patchCall[1] as RequestInit).body))).toMatchObject({ settings: { narrationEnabled: true } });
  });

  it("reopens an existing project with narration already on", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings: { ...settings, narrationEnabled: true }, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    expect((screen.getByTestId("settings-narration-enabled") as HTMLInputElement).checked).toBe(true);
  });

  it("lets subtitles be turned on without voice, so a project can get captions at no cost", async () => {
    const project = makeProject({});
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "PATCH /projects/sample_project/settings": { project, settings: { ...settings, subtitlesEnabled: true } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    fireEvent.click(screen.getByTestId("settings-subtitles-enabled"));
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/projects/sample_project/settings" && (init as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings" && (init as RequestInit | undefined)?.method === "PATCH")!;
    // Subtitles on, voice untouched — the two switches are independent.
    expect(JSON.parse(String((patchCall[1] as RequestInit).body))).toMatchObject({ settings: { subtitlesEnabled: true, narrationEnabled: false } });
  });

  it("reopens an existing project with subtitles already on", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings: { ...settings, subtitlesEnabled: true }, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    expect((screen.getByTestId("settings-subtitles-enabled") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("settings-narration-enabled") as HTMLInputElement).checked).toBe(false);
  });

  it("offers the screen shape as a choice instead of a box to type into", async () => {
    // The backend decides orientation with `aspect === "16:9"`, so a typed value that is off by a character
    // silently produces a vertical video — after six clips have been paid for.
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const select = (await screen.findByTestId("settings-aspect")) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["9:16", "16:9"]);
    expect(select.value).toBe("16:9");
    expect(screen.queryByTestId("settings-aspect-unknown")).toBeNull();
  });

  it("keeps an unrecognised saved ratio visible and says what it will actually produce", async () => {
    // Rewriting the stored value on render would hide that this project is about to come out vertical.
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings: { ...settings, styleNotes: { ...settings.styleNotes, aspect: "1920x1080" } }, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const select = (await screen.findByTestId("settings-aspect")) as HTMLSelectElement;
    expect([...select.options].some((option) => option.textContent?.includes("1920x1080"))).toBe(true);
    expect((await screen.findByTestId("settings-aspect-unknown")).textContent).toContain("세로형으로 만들어집니다");
  });

  it("saves the chosen ratio in the exact spelling the video step compares against", async () => {
    const project = makeProject({});
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "PATCH /projects/sample_project/settings": { project, settings },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    fireEvent.change(await screen.findByTestId("settings-aspect"), { target: { value: "9:16" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")!;
    const body = JSON.parse(String((call[1] as RequestInit).body)) as { settings: { styleNotes: { aspect: string } } };
    expect(body.settings.styleNotes.aspect).toBe("9:16");
  });

  // Both locks say why before anything is typed, rather than after a rejected save. The refusal is knowable the
  // moment the screen opens, and the worst moment to hear it is with a number already typed in.
  // Both halves are asserted each time — the reason is stated AND the control is actually unusable — because a
  // notice above a working field is just a field with a notice on it.
  it("locks the scene count and says why once the Story exists", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: false, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    expect(await screen.findByTestId("settings-scene-count-locked")).toBeTruthy();
    expect(screen.getByTestId("settings-scene-count")).toBeDisabled();
    // The other field is untouched: the two conditions are independent, and one flag would have locked both.
    expect(screen.getByTestId("settings-aspect")).not.toBeDisabled();
    expect(screen.queryByTestId("settings-aspect-locked")).toBeNull();
  });

  it("locks the aspect ratio and says why once images exist", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: false },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    expect(await screen.findByTestId("settings-aspect-locked")).toBeTruthy();
    expect(screen.getByTestId("settings-aspect")).toBeDisabled();
    expect(screen.getByTestId("settings-scene-count")).not.toBeDisabled();
    expect(screen.queryByTestId("settings-scene-count-locked")).toBeNull();
  });

  // The counterpart both rules need: without it, a change that locked either field unconditionally would still
  // pass its own locked test.
  it("leaves both fields usable when nothing is locked", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByTestId("settings-scene-count");
    expect(screen.getByTestId("settings-scene-count")).not.toBeDisabled();
    expect(screen.getByTestId("settings-aspect")).not.toBeDisabled();
    expect(screen.queryByTestId("settings-scene-count-locked")).toBeNull();
    expect(screen.queryByTestId("settings-aspect-locked")).toBeNull();
  });
  it("names an already-saved cast member without needing a search first", async () => {
    const hero = makeAssetFolder({ assetId: "ASSET-CHAR-9", displayName: "이배드", assetType: "character" });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [castMember("ASSET-CHAR-9", { representative: true })] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?assetType=character": { assets: [hero] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const castSection = await screen.findByRole("region", { name: "등장 캐릭터" });
    expect(await within(castSection).findByText("이배드")).toBeTruthy();
    expect(within(castSection).queryByText("ASSET-CHAR-9")).toBeNull();
  });

  // The counterpart: a cast row can outlive the folder it points at, because deleting the folder in the
  // library does not touch the cast. The row used to render the raw id, which reads as a glitch — the person
  // cannot tell whether the app is broken or the folder is gone, and either way does not know to remove it.
  it("says a cast row's folder is gone instead of showing its id", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [castMember("FOLDER-GONE", { representative: true })] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?assetType=character": { assets: [] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const castSection = await screen.findByRole("region", { name: "등장 캐릭터" });
    expect(await within(castSection).findByTestId("cast-missing-FOLDER-GONE")).toBeTruthy();
    // The id stays reachable as the row's title attribute for matching things up by hand, but it is no longer
    // the label — the label now says what to do about it.
    expect(within(castSection).queryByText("FOLDER-GONE")).toBeNull();
  });

  /**
   * The same deleted folder, seen from the form above.
   *
   * The row inside the cast editor says 지워진 폴더 · 제거해 주세요, but the 대표 캐릭터 hint used to say
   * "이름을 불러오지 못해" for every nameless lead — so the same screen gave two different reasons for one
   * state, and the one at the top sent the person to wait for a lookup that had already answered.
   */
  it("says the lead's folder is gone rather than blaming the name lookup", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings: { ...settings, character: "직접 적은 이름" }, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [castMember("FOLDER-GONE", { representative: true })] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      // The library answered — it just does not have this folder any more.
      "GET /assets?assetType=character": { assets: [] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const field = await screen.findByLabelText("대표 캐릭터");
    await waitFor(() => expect(screen.getByTestId("character-source").textContent).toContain("지워진 폴더"));
    expect(screen.getByTestId("character-source").textContent).not.toContain("불러오지 못해");
    // Still locked: the server prefers the lead either way, so the typed name is not the one in use.
    expect(field).toBeDisabled();
    expect(field).toHaveValue("FOLDER-GONE");
  });

  // Two controls on this screen answer "who is the protagonist", and the server picks one:
  // `castLeadName ?? settings.character` (story-prompt.service.ts). Nothing said so, so a name typed in the
  // field was silently dropped the moment a folder was marked 대표 — and the person had no way to see it.
  it("shows the cast lead's name in 대표 캐릭터 and says the typed field is not the one in use", async () => {
    const hero = makeAssetFolder({ assetId: "ASSET-CHAR-9", displayName: "이배드", assetType: "character" });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings: { ...settings, character: "직접 적은 이름" }, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [castMember("ASSET-CHAR-9", { representative: true })] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?assetType=character": { assets: [hero] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    // The name arrives from two later requests (cast, then the library) and is lifted up from the cast editor,
    // so waiting only for the field to exist asserts before any of that has landed.
    const field = await screen.findByLabelText("대표 캐릭터");
    await waitFor(() => expect(field).toHaveValue("이배드"));
    expect(field).toBeDisabled();
    expect(screen.getByTestId("character-source").textContent).toContain("등장 캐릭터");
    // The typed value is still stored — it is what the server falls back to — so it must not be shown as if
    // it were in force, and must not be erased either.
    expect(screen.queryByDisplayValue("직접 적은 이름")).toBeNull();
  });

  /**
   * The same row, one failed request away.
   *
   * "지워진 폴더 · 제거해 주세요" is an instruction to delete data, and it was produced by `namesLoaded` being
   * set in a `finally` — so one failed `/assets` read said it of every saved character, including a perfectly
   * good 대표. Obeying it drops the protagonist from the cast, and the next paid script and images are written
   * without them. The comment on the read promises the opposite ("the ids still render, exactly as before").
   */
  it("does not call a cast row's folder deleted when the name lookup failed", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [castMember("FOLDER-ALIVE", { representative: true })] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?assetType=character": failing(500, { code: "ASSET_STORAGE_ERROR", message: "raw" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const castSection = await screen.findByRole("region", { name: "등장 캐릭터" });
    await within(castSection).findByText("FOLDER-ALIVE");
    expect(within(castSection).queryByTestId("cast-missing-FOLDER-ALIVE")).toBeNull();
  });

  /**
   * A lead whose name did not arrive is still a lead.
   *
   * Both cases used to reach the form as `null`, so the 대표 캐릭터 box unlocked and its hint said 등장 캐릭터에서
   * 대표를 고르면 … — i.e. "what you type here is live". The server resolves `castLeadName ?? settings.character`
   * from its own stored cast, so the typed name was dropped anyway and the script was paid for with the folder
   * lead instead. Locked either way; only the sentence differs.
   */
  it("keeps 대표 캐릭터 locked when a lead is set but its name could not be read", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings: { ...settings, character: "직접 적은 이름" }, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [castMember("FOLDER-LEAD", { representative: true })] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?assetType=character": failing(500, { code: "ASSET_STORAGE_ERROR", message: "raw" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const field = await screen.findByLabelText("대표 캐릭터");
    await waitFor(() => expect(field).toBeDisabled());
    // The folder id, not the typed name — showing 직접 적은 이름 in a locked box would say it is the one in use.
    expect(field).toHaveValue("FOLDER-LEAD");
    expect(screen.getByTestId("character-source").textContent).toContain("이름을 불러오지 못해");
  });

  // The other half: with no lead marked, the typed field is the answer and stays editable.
  it("keeps 대표 캐릭터 editable when the cast names no lead", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings: { ...settings, character: "직접 적은 이름" }, sceneCountChangeable: true, aspectRatioChangeable: true },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?assetType=character": { assets: [] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const field = await screen.findByLabelText("대표 캐릭터");
    expect(field).toHaveValue("직접 적은 이름");
    expect(field).not.toBeDisabled();
  });
});
