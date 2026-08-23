import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeAsset, makeProject } from "../api/testUtils.js";
import { ShortProjectSettingsScreen } from "./ShortProjectSettingsScreen.js";

const settings = {
  projectName: "별의 지도", topic: "별을 찾는 아이", genre: "판타지", mood: "따뜻함", character: "아이",
  lore: "별의 세계", fullStory: "별을 찾는다.", durationSeconds: 30, sceneCount: 6,
  additionalNotes: "", styleNotes: { aspect: "16:9", lighting: "달빛" },
};

/** Routes fetch calls by URL/method so test order doesn't depend on the settings screen's internal fetch sequencing. */
function stubFetchByRoute(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    if (key in routes) return jsonResponse(200, routes[key]);
    throw new Error(`Unexpected fetch call in test: ${key}`);
  });
  return fetchMock;
}

describe("ShortProjectSettingsScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reopens saved Wizard settings and saves an edited topic through PATCH", async () => {
    const project = makeProject({ topic: "새 주제" });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings },
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
    expect(JSON.parse(String((patchCall[1] as RequestInit).body))).toMatchObject({ settings: { topic: "새 주제", sceneCount: 6 } });
  });

  it("blocks empty project name before sending PATCH", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings },
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

  it("shows the current cast, adds a searched character, and removes a cast member", async () => {
    const hero = makeAsset({ assetId: "ASSET-CHAR-1", displayName: "주인공", assetType: "character" });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?query=%EC%A3%BC%EC%9D%B8%EA%B3%B5&assetType=character": { assets: [hero] },
      "PUT /projects/sample_project/settings/cast": { cast: [{ assetId: "ASSET-CHAR-1", castRole: "supporting", storyRole: "서브 캐릭터" }] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const castSection = await screen.findByRole("region", { name: "등장 캐릭터" });
    await within(castSection).findByText("선택된 캐릭터가 없습니다.");

    const searchForm = within(castSection).getByRole("form", { name: "캐릭터 Asset 검색" });
    fireEvent.change(within(searchForm).getByLabelText("캐릭터 검색"), { target: { value: "주인공" } });
    fireEvent.click(within(searchForm).getByRole("button", { name: "검색" }));
    await screen.findByText("주인공");

    fireEvent.click(within(castSection).getByRole("button", { name: "추가" }));
    await screen.findByText("ASSET-CHAR-1");
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/projects/sample_project/settings/cast" && (init as RequestInit | undefined)?.method === "PUT")).toBe(true);
  });

  it("removes a cast member through the same PUT endpoint", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings },
      "GET /projects/sample_project/settings/cast": { cast: [{ assetId: "ASSET-CHAR-1", castRole: "protagonist", storyRole: "대표 캐릭터" }] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "PUT /projects/sample_project/settings/cast": { cast: [] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const castSection = await screen.findByRole("region", { name: "등장 캐릭터" });
    await within(castSection).findByText("ASSET-CHAR-1");
    fireEvent.click(within(castSection).getByRole("button", { name: "제거" }));

    await within(castSection).findByText("선택된 캐릭터가 없습니다.");
    const putCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/projects/sample_project/settings/cast" && (init as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse(String((putCall[1] as RequestInit).body))).toEqual({ cast: [] });
  });

  it("shows a cast-load error without breaking the rest of the settings screen", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/projects/sample_project/settings") return jsonResponse(200, { settings });
      if (url === "/projects/sample_project/settings/cast") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "캐릭터 목록을 불러오지 못했습니다." });
      if (url === "/projects/sample_project/settings/asset-references") return jsonResponse(200, { atmosphereAssetIds: [], sceneReferenceAssets: [] });
      if (url === "/projects/sample_project/settings/continuity") return jsonResponse(200, { link: null });
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    const alert = await screen.findByTestId("cast-error");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_STORAGE_ERROR");
    expect(alert.textContent).toBe("캐릭터 목록을 불러오지 못했습니다.");
  });

  it("shows the current atmosphere/scene reference Assets, adds a searched atmosphere Asset, and removes it", async () => {
    const style = makeAsset({ assetId: "ASSET-STYLE-1", displayName: "네온 팔레트", assetType: "style" });
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?query=%EB%84%A4%EC%98%A8": { assets: [style] },
      "PUT /projects/sample_project/settings/asset-references": { atmosphereAssetIds: ["ASSET-STYLE-1"], sceneReferenceAssets: [] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const refsSection = await screen.findByRole("region", { name: "분위기·장면 참고 Asset" });
    await within(refsSection).findByText("선택된 분위기 Asset이 없습니다.");

    const searchForm = within(refsSection).getByRole("form", { name: "분위기 Asset 검색" });
    fireEvent.change(within(searchForm).getByLabelText("분위기 Asset 검색"), { target: { value: "네온" } });
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
      "GET /projects/sample_project/settings": { settings },
      "GET /projects/sample_project/settings/cast": { cast: [] },
      "GET /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [] },
      "GET /projects/sample_project/settings/continuity": { link: null },
      "GET /assets?query=%EC%97%B4%EC%87%A0": { assets: [key] },
      "PUT /projects/sample_project/settings/asset-references": { atmosphereAssetIds: [], sceneReferenceAssets: [{ assetId: "ASSET-OBJECT-1", purpose: "주인공이 항상 들고 다니는 열쇠" }] },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    const refsSection = await screen.findByRole("region", { name: "분위기·장면 참고 Asset" });
    const searchForm = await within(refsSection).findByRole("form", { name: "장면 참고 Asset 검색" });
    fireEvent.change(within(searchForm).getByLabelText("장면 참고 Asset 검색"), { target: { value: "열쇠" } });
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
      if (url === "/projects/sample_project/settings") return jsonResponse(200, { settings });
      if (url === "/projects/sample_project/settings/cast") return jsonResponse(200, { cast: [] });
      if (url === "/projects/sample_project/settings/asset-references") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "참고 Asset 목록을 불러오지 못했습니다." });
      if (url === "/projects/sample_project/settings/continuity") return jsonResponse(200, { link: null });
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    const alert = await screen.findByTestId("asset-reference-error");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_STORAGE_ERROR");
    expect(alert.textContent).toBe("참고 Asset 목록을 불러오지 못했습니다.");
  });

  it("lists continuity options, links to one, and disconnects it again", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/sample_project/settings": { settings },
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
      "GET /projects/sample_project/settings": { settings },
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
      if (url === "/projects/sample_project/settings") return jsonResponse(200, { settings });
      if (url === "/projects/sample_project/settings/cast") return jsonResponse(200, { cast: [] });
      if (url === "/projects/sample_project/settings/asset-references") return jsonResponse(200, { atmosphereAssetIds: [], sceneReferenceAssets: [] });
      if (url === "/projects/sample_project/settings/continuity") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "연결 정보를 불러오지 못했습니다." });
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByDisplayValue("별의 지도");
    const alert = await screen.findByTestId("continuity-error");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_STORAGE_ERROR");
    expect(alert.textContent).toBe("연결 정보를 불러오지 못했습니다.");
  });
});
