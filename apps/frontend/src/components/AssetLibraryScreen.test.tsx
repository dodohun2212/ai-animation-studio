import type { Asset, GetAssetResponse, ListAssetsResponse } from "@ai-animation-studio/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeAsset, makeAssetFolder, answerOutOfBand } from "../api/testUtils.js";
import { AssetLibraryScreen, assetListName, coverUrl, rowSubtitle } from "./AssetLibraryScreen.js";

function searchForm(): HTMLFormElement {
  return screen.getByRole("button", { name: "검색" }).closest("form") as HTMLFormElement;
}
function importForm(): HTMLElement {
  // The import form is collapsed by default — open it via its toolbar toggle on first access.
  const existing = screen.queryByRole("form", { name: "에셋 가져오기" });
  if (existing) return existing;
  fireEvent.click(screen.getByTestId("import-toggle"));
  return screen.getByRole("form", { name: "에셋 가져오기" });
}
/** Clicks the in-screen confirmation panel's proceed button (replaces the old window.confirm flow). */
function confirmPanelProceed(): void {
  fireEvent.click(within(screen.getByTestId("asset-confirm-panel")).getByRole("button", { name: "네, 진행합니다" }));
}
function confirmPanelCancel(): void {
  fireEvent.click(within(screen.getByTestId("asset-confirm-panel")).getByRole("button", { name: "취소" }));
}
function detailRegion(): HTMLElement {
  return screen.getByRole("region", { name: "에셋 상세" });
}
function editForm(): HTMLElement {
  return within(detailRegion()).getByRole("form", { name: "에셋 정보 편집" });
}

/**
 * Routes each `fetch` call by "METHOD url" instead of call order — needed once a component issues
 * requests whose exact count/sequence isn't fixed (e.g. AssetLibraryScreen's per-child `getAsset`
 * effect, which can re-fire whenever a folder's `childAssetIds` order changes). A route value may be
 * a single body (returned for every call to that route) or an array of bodies consumed in order, with
 * the last one repeating for any further calls.
 */
function stubFetchByRoute(routes: Record<string, unknown | unknown[]>): ReturnType<typeof vi.fn> {
  const queues = new Map<string, unknown[]>();
  for (const [key, value] of Object.entries(routes)) {
    queues.set(key, Array.isArray(value) ? [...value] : [value]);
  }
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    const queue = queues.get(key);
    if (!queue || queue.length === 0) throw new Error(`Unexpected fetch call in test: ${key}`);
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return jsonResponse(200, body);
  });
}

async function fillAndSubmitImport(file: File, name: string): Promise<void> {
  const form = importForm();
  fireEvent.change(within(form).getByLabelText("이미지 파일"), { target: { files: [file] } });
  fireEvent.change(within(form).getByLabelText("이름"), { target: { value: name } });
  fireEvent.click(within(form).getByRole("button", { name: "가져오기" }));
}

/**
 * The "만든 이미지" section on this screen fetches its own list on mount. These tests are about the asset
 * library and have no opinion about it, so it is answered out of band rather than threaded through every
 * call-order chain in the file — which would have buried what each test is actually checking.
 */
const withGeneratedImages = (fetchMock: ReturnType<typeof vi.fn>) =>
  answerOutOfBand({ "GET /images/generated": { projects: [], episodes: [] } }, fetchMock);

describe("AssetLibraryScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows loading, then the backend's asset list in the order it was returned", async () => {
    const response: ListAssetsResponse = {
      assets: [
        makeAsset({ assetId: "ASSET-1", displayName: "두번째로 정렬되어야 할 이름", assetType: "style" }),
        makeAsset({ assetId: "ASSET-2", displayName: "가나다순으로는 먼저인 이름", assetType: "character" }),
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));

    render(<AssetLibraryScreen onBack={() => {}} />);
    expect(screen.getByText("에셋을 불러오는 중...")).toBeTruthy();

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    const items = within(list).getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(items[0]).toContain("두번째로 정렬되어야 할 이름");
    expect(items[1]).toContain("가나다순으로는 먼저인 이름");
    expect(fetchMock).toHaveBeenCalledWith("/assets");
  });

  it("pre-fills the search box and searches with initialQuery on mount, e.g. when opened as a project's gallery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));

    render(<AssetLibraryScreen onBack={() => {}} initialQuery="my_project" />);

    await screen.findByText("등록된 에셋이 없습니다.");
    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.get("query")).toBe("my_project");
    expect((screen.getByLabelText("검색") as HTMLInputElement).value).toBe("my_project");
  });

  it("shows the empty state when the backend returns no assets", async () => {
    vi.stubGlobal("fetch", withGeneratedImages(vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] }))));
    render(<AssetLibraryScreen onBack={() => {}} />);

    expect(await screen.findByText("등록된 에셋이 없습니다.")).toBeTruthy();
  });

  it("shows a fixed, safe Korean message and identifiable code when the initial load fails", async () => {
    vi.stubGlobal("fetch", withGeneratedImages(vi.fn().mockResolvedValue(jsonResponse(500, { code: "ASSET_STORAGE_ERROR", message: "disk failure at C:\\secret\\path" }))));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("에셋을 저장하거나 읽지 못했습니다.");
    expect(alert).toHaveAttribute("data-error-code", "ASSET_STORAGE_ERROR");
  });

  it("never renders the backend's raw message, details, path, or stack anywhere in the DOM", async () => {
    vi.stubGlobal("fetch", withGeneratedImages(vi.fn().mockResolvedValue(jsonResponse(500, {
      code: "ASSET_DATA_INVALID",
      message: "raw internal detail C:\\Users\\secret\\learning_data",
      details: { path: "C:\\Users\\secret", stack: "at Object.<anonymous> (file.ts:1:1)" },
    }))));
    const rendered = render(<AssetLibraryScreen onBack={() => {}} />);

    await screen.findByRole("alert");
    expect(rendered.container.innerHTML).not.toContain("secret");
    expect(rendered.container.innerHTML).not.toContain("C:\\");
    expect(rendered.container.innerHTML).not.toContain("raw internal detail");
  });

  it("searches with a trimmed query and an exact asset type filter, preserving the backend's response order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, {
        assets: [makeAsset({ assetId: "ASSET-2", displayName: "b", assetType: "character" }), makeAsset({ assetId: "ASSET-1", displayName: "a", assetType: "character" })],
      }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    const form = searchForm();
    fireEvent.change(within(form).getByLabelText("검색"), { target: { value: "  고양이  " } });
    fireEvent.change(within(form).getByLabelText("유형"), { target: { value: "character" } });
    fireEvent.click(within(form).getByRole("button", { name: "검색" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url] = fetchMock.mock.calls[1] as [string];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.get("query")).toBe("고양이");
    expect(parsed.searchParams.get("assetType")).toBe("character");

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    const items = within(list).getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(items[0]).toContain("b");
    expect(items[1]).toContain("a");
  });

  it("imports a new asset via a multipart file input with minimal metadata, then reopens it in the detail view", async () => {
    const created = makeAsset({ assetId: "ASSET-NEW", displayName: "새 캐릭터", assetType: "character" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] })) // initial load
      .mockResolvedValueOnce(jsonResponse(200, { asset: created })) // create
      .mockResolvedValueOnce(jsonResponse(200, { assets: [created] })) // reload
      .mockResolvedValueOnce(jsonResponse(200, { asset: created, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })); // reopen
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    const file = new File(["binary-bytes"], "cat.png", { type: "image/png" });
    await fillAndSubmitImport(file, "새 캐릭터");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [createUrl, createInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(createUrl).toBe("/assets");
    expect(createInit.method).toBe("POST");
    const body = createInit.body as FormData;
    expect(body.get("image")).toBe(file);

    expect(await screen.findByRole("region", { name: "에셋 상세" })).toBeTruthy();
    expect(within(detailRegion()).getByText("새 캐릭터")).toBeTruthy();
  });

  it("resets the underlying file input's DOM value after a successful import, not just the React state", async () => {
    const created = makeAsset({ assetId: "ASSET-NEW", displayName: "새 캐릭터" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: created }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [created] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: created, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    const file = new File(["binary-bytes"], "cat.png", { type: "image/png" });
    await fillAndSubmitImport(file, "새 캐릭터");

    await screen.findByRole("region", { name: "에셋 상세" });
    const fileInput = within(importForm()).getByLabelText("이미지 파일") as HTMLInputElement;
    expect(fileInput.files?.length ?? 0).toBe(0);
    expect(fileInput.value).toBe("");
  });

  it("shows an accessible fixed validation error and sends no request when submitting the import form without a file or a name", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { assets: [] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(within(importForm()).getByRole("button", { name: "가져오기" }));

    const validationError = await screen.findByTestId("import-validation-error");
    expect(validationError.textContent).toBe("이미지 파일과 이름을 모두 입력해 주세요.");
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial list load — no create request

    const file = new File(["binary-bytes"], "cat.png", { type: "image/png" });
    fireEvent.change(within(importForm()).getByLabelText("이미지 파일"), { target: { files: [file] } });
    fireEvent.click(within(importForm()).getByRole("button", { name: "가져오기" }));

    const stillMissingName = await screen.findByTestId("import-validation-error");
    expect(stillMissingName.textContent).toBe("이미지 파일과 이름을 모두 입력해 주세요.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prevents a duplicate import submission while the request is in flight", async () => {
    let resolveCreate: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveCreate = resolve; }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    const file = new File(["binary-bytes"], "cat.png", { type: "image/png" });
    const form = importForm();
    fireEvent.change(within(form).getByLabelText("이미지 파일"), { target: { files: [file] } });
    fireEvent.change(within(form).getByLabelText("이름"), { target: { value: "중복 방지" } });
    const submitButton = within(form).getByRole("button", { name: "가져오기" });
    fireEvent.click(submitButton);

    expect(within(form).getByLabelText("이미지 파일")).toBeDisabled();
    expect(within(form).getByLabelText("이름")).toBeDisabled();
    expect(within(form).getByLabelText("설명")).toBeDisabled();
    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton);

    expect(fetchMock).toHaveBeenCalledTimes(2); // initial load + exactly one create
    resolveCreate(jsonResponse(200, { asset: makeAsset({ displayName: "중복 방지" }) }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(2));
  });

  it("opens an asset's detail view showing usage and ownership when a list item is clicked", async () => {
    const asset = makeAsset({ assetId: "ASSET-USED", displayName: "사용 중 에셋" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: ["project_a", "project_b"], ownership: "project_owned", canDeleteOwnedFile: false }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("사용 중 에셋"));

    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    expect(within(detail).getByText("소유권: project_owned")).toBeTruthy();
    expect(within(detail).getByText("사용 프로젝트: project_a, project_b")).toBeTruthy();
  });

  it("reorders character-folder reference children and can change the representative without any provider request", async () => {
    const first = makeAsset({ assetId: "CHAR-1", assetType: "character", displayName: "Front", parentFolderId: "FOLDER-CHAR", sortOrder: 0 });
    const second = makeAsset({ assetId: "CHAR-2", assetType: "character", displayName: "Side", parentFolderId: "FOLDER-CHAR", sortOrder: 1 });
    const folder = makeAsset({ assetId: "FOLDER-CHAR", assetType: "character", displayName: "Hero references", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: ["CHAR-1", "CHAR-2"], thumbnailAssetId: "CHAR-1" });
    const updatedFolder = { ...folder, childAssetIds: ["CHAR-2", "CHAR-1"], thumbnailAssetId: "CHAR-1" };
    const representativeFolder = { ...updatedFolder, thumbnailAssetId: "CHAR-2" };
    // Routed by URL, not call order — the per-child getAsset() effect re-fires whenever childAssetIds's
    // order changes (after each reorder/representative change), so the exact call sequence isn't fixed.
    const fetchMock = stubFetchByRoute({
      "GET /assets": { assets: [folder, first, second] },
      "GET /assets/FOLDER-CHAR": { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "GET /assets/CHAR-1": { asset: first, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "GET /assets/CHAR-2": { asset: second, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "PATCH /assets/FOLDER-CHAR/character-reference-set": [
        { folder: updatedFolder, children: [second, first] },
        { folder: representativeFolder, children: [second, first] },
      ],
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("Hero references"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const set = within(detail).getByRole("region", { name: "폴더 구성" });
    await waitFor(() => expect(within(set).getByRole("list", { name: "순서가 있는 참고 이미지" }).textContent).toContain("1. Front"));

    fireEvent.click(within(set).getAllByRole("button", { name: "아래로" })[0]!);
    await waitFor(() => expect(within(set).getByRole("list", { name: "순서가 있는 참고 이미지" }).textContent).toContain("1. Side"));
    const patchCalls = fetchMock.mock.calls.filter(([url]) => String(url) === "/assets/FOLDER-CHAR/character-reference-set") as Array<[string, RequestInit]>;
    expect(patchCalls[0]![1].method).toBe("PATCH");
    expect(JSON.parse(String(patchCalls[0]![1].body))).toEqual({ childAssetIds: ["CHAR-2", "CHAR-1"], thumbnailAssetId: "CHAR-1" });

    fireEvent.click(within(set).getAllByRole("button", { name: "대표 이미지로 정하기" })[0]!);
    await waitFor(() => expect(within(set).getByText(/Side \(대표 이미지\)/)).toBeTruthy());
    const patchCallsAfterRepresentative = fetchMock.mock.calls.filter(([url]) => String(url) === "/assets/FOLDER-CHAR/character-reference-set") as Array<[string, RequestInit]>;
    expect(JSON.parse(String(patchCallsAfterRepresentative[1]![1].body))).toEqual({ childAssetIds: ["CHAR-2", "CHAR-1"], thumbnailAssetId: "CHAR-2" });
    for (const [calledUrl] of fetchMock.mock.calls as Array<[string]>) {
      expect(calledUrl).toMatch(/^\/assets/);
      expect(calledUrl).not.toContain("/videos/");
      expect(calledUrl).not.toContain("providers");
    }
  });

  /**
   * 🔴 「하위 항목의 원본 파일도 함께 삭제」는 손으로 등록하지 않은 항목이 하나라도 있으면 백엔드가 **삭제 전체를
   * 거절**합니다. 그리고 이 화면은 하위 항목마다 `getAsset` 을 이미 부르고 있어서, 그 답(`canDeleteOwnedFile`)을
   * **손에 쥐고 있으면서 버렸습니다** — 사람은 되돌릴 수 없는 버튼을 누른 뒤에야 거절로 알게 됐습니다.
   */
  function folderWithChildren(childIds: string[]) {
    return makeAsset({
      assetId: "FOLDER-DEL", assetType: "character", displayName: "지울 폴더", isFolder: true,
      imageAvailable: false, contentSha256: "", versions: [], referenceImages: [],
      childAssetIds: childIds, thumbnailAssetId: childIds[0] ?? "",
    });
  }

  it("says before the button that a folder holds files it cannot delete, and locks that choice", async () => {
    const manual = makeAsset({ assetId: "CHILD-MANUAL", assetType: "character", displayName: "손으로 넣은 것", parentFolderId: "FOLDER-DEL", sortOrder: 0 });
    const owned = makeAsset({ assetId: "CHILD-OWNED", assetType: "character", displayName: "프로젝트가 만든 것", parentFolderId: "FOLDER-DEL", sortOrder: 1 });
    const folder = folderWithChildren(["CHILD-MANUAL", "CHILD-OWNED"]);
    vi.stubGlobal("fetch", withGeneratedImages(stubFetchByRoute({
      "GET /assets": { assets: [folder, manual, owned] },
      "GET /assets/FOLDER-DEL": { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "GET /assets/CHILD-MANUAL": { asset: manual, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      // 이 한 항목이 삭제 전체를 거절시킵니다 — 서버가 그렇다고 이미 답했습니다.
      "GET /assets/CHILD-OWNED": { asset: owned, usageProjectIds: [], ownership: "project_owned", canDeleteOwnedFile: false },
    })));
    render(<AssetLibraryScreen onBack={() => {}} />);

    fireEvent.click(within(await screen.findByRole("list", { name: "에셋 목록" })).getByText("지울 폴더"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByText("폴더 삭제", { selector: "summary" }));

    const blocked = await within(detail).findByTestId("folder-file-delete-blocked");
    expect(blocked.textContent, "몇 개가 막는지").toContain("1개");
    expect(blocked.textContent, "대신 할 수 있는 일도").toContain("색인만 지우는 것은");
    expect(within(detail).getByLabelText(/하위 항목의 원본 파일도 함께 삭제/)).toBeDisabled();
    expect(within(detail).queryByTestId("folder-file-delete-unchecked"), "모르는 게 아니라 아는 상태입니다").toBeNull();
  });

  /** 반대쪽: 전부 손으로 넣은 폴더는 잠기지 않고 아무 말도 붙지 않습니다 — 늘 뜨는 경고는 읽히지 않습니다. */
  it("leaves the file-delete choice open when every child's file can be deleted", async () => {
    const first = makeAsset({ assetId: "CHILD-A", assetType: "character", displayName: "첫째", parentFolderId: "FOLDER-DEL", sortOrder: 0 });
    const folder = folderWithChildren(["CHILD-A"]);
    vi.stubGlobal("fetch", withGeneratedImages(stubFetchByRoute({
      "GET /assets": { assets: [folder, first] },
      "GET /assets/FOLDER-DEL": { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "GET /assets/CHILD-A": { asset: first, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
    })));
    render(<AssetLibraryScreen onBack={() => {}} />);

    fireEvent.click(within(await screen.findByRole("list", { name: "에셋 목록" })).getByText("지울 폴더"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByText("폴더 삭제", { selector: "summary" }));

    await waitFor(() => expect(within(detail).getByLabelText(/하위 항목의 원본 파일도 함께 삭제/)).not.toBeDisabled());
    expect(within(detail).queryByTestId("folder-file-delete-blocked")).toBeNull();
    expect(within(detail).queryByTestId("folder-file-delete-unchecked")).toBeNull();
  });

  /**
   * 🔴 「막는 게 없다」와 「모른다」는 다릅니다. 하위 항목 하나를 못 읽었으면 읽은 것만 보고 안전하다고 말할 수
   * 없습니다 — 그렇다고 잠그지도 않습니다(모른다고 못 하게 하면 그게 막다른 골목입니다).
   */
  it("does not call an unread folder safe, and does not lock it either", async () => {
    const first = makeAsset({ assetId: "CHILD-A", assetType: "character", displayName: "첫째", parentFolderId: "FOLDER-DEL", sortOrder: 0 });
    const second = makeAsset({ assetId: "CHILD-B", assetType: "character", displayName: "둘째", parentFolderId: "FOLDER-DEL", sortOrder: 1 });
    const folder = folderWithChildren(["CHILD-A", "CHILD-B"]);
    const base = stubFetchByRoute({
      "GET /assets": { assets: [folder, first, second] },
      "GET /assets/FOLDER-DEL": { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "GET /assets/CHILD-A": { asset: first, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      // 둘째 항목만 실패시킵니다 — 읽은 첫째는 지울 수 있는 것이라, 읽은 것만 보면 「막는 게 없다」로 보입니다.
      if (String(input) === "/assets/CHILD-B") throw new Error("network");
      // `stubFetchByRoute` returns a bare vi.fn; typed as fetch so it can be called through here.
      return (base as unknown as typeof fetch)(input, init);
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    fireEvent.click(within(await screen.findByRole("list", { name: "에셋 목록" })).getByText("지울 폴더"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByText("폴더 삭제", { selector: "summary" }));

    const unchecked = await within(detail).findByTestId("folder-file-delete-unchecked");
    expect(unchecked.textContent).toContain("확인하지 못했습니다");
    expect(unchecked.textContent, "무슨 일이 벌어지는지도").toContain("삭제 전체가 거절됩니다");
    expect(within(detail).getByLabelText(/하위 항목의 원본 파일도 함께 삭제/), "모른다고 막지는 않습니다").not.toBeDisabled();
    expect(within(detail).queryByTestId("folder-file-delete-blocked")).toBeNull();
  });

  it("edits metadata for the selected asset and refreshes the list without losing the detail view", async () => {
    const asset = makeAsset({ assetId: "ASSET-EDIT", displayName: "원래 이름" });
    const updated = { ...asset, displayName: "바뀐 이름" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: updated }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [updated] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("원래 이름"));
    await screen.findByRole("region", { name: "에셋 상세" });

    const form = editForm();
    fireEvent.change(within(form).getByLabelText("이름"), { target: { value: "바뀐 이름" } });
    fireEvent.click(within(form).getByRole("button", { name: "변경 저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/assets/ASSET-EDIT");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({ displayName: "바뀐 이름" });
    expect(within(detailRegion()).getByText("바뀐 이름")).toBeTruthy();
  });

  it("guards delete: disables the delete button and shows guidance for an asset in use", async () => {
    const asset = makeAsset({ assetId: "ASSET-USED", displayName: "삭제 불가" });
    vi.stubGlobal("fetch", withGeneratedImages(vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: ["project_a"], ownership: "project_owned", canDeleteOwnedFile: false }))));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("삭제 불가"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });

    const deleteButton = within(detail).getByRole("button", { name: "목록에서 삭제" });
    expect(deleteButton).toBeDisabled();
    expect(within(detail).getByText("사용 중인 에셋은 삭제할 수 없습니다.")).toBeTruthy();
  });

  it("deletes an unused asset only after explicit confirmation, then closes the detail view and refreshes the list", async () => {
    const asset = makeAsset({ assetId: "ASSET-FREE", displayName: "삭제 가능" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { assetId: "ASSET-FREE", deletedOwnedFile: false }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("삭제 가능"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByRole("button", { name: "목록에서 삭제" }));

    expect(fetchMock).toHaveBeenCalledTimes(2); // opening the confirm panel sends nothing
    confirmPanelProceed();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/assets/ASSET-FREE");
    expect(init.method).toBe("DELETE");
    await waitFor(() => expect(screen.queryByRole("region", { name: "에셋 상세" })).toBeNull());
    expect(await screen.findByText("등록된 에셋이 없습니다.")).toBeTruthy();
  });

  it("does not delete when the confirmation dialog is cancelled", async () => {
    const asset = makeAsset({ assetId: "ASSET-FREE", displayName: "삭제 가능" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("삭제 가능"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByRole("button", { name: "목록에서 삭제" }));
    confirmPanelCancel();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("asset-confirm-panel")).toBeNull();
    expect(screen.getByRole("region", { name: "에셋 상세" })).toBeTruthy();
  });

  it("ignores a stale detail response that resolves after a newer selection was already requested", async () => {
    const assetA = makeAsset({ assetId: "ASSET-A", displayName: "먼저 연 에셋" });
    const assetB = makeAsset({ assetId: "ASSET-B", displayName: "나중에 연 에셋" });
    let resolveA: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA, assetB] }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveA = resolve; })) // open A: slow
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetB, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })); // open B: fast
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("먼저 연 에셋"));
    fireEvent.click(within(list).getByText("나중에 연 에셋"));

    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    expect(within(detail).getByText("나중에 연 에셋")).toBeTruthy();

    // The older, slower request for A now resolves after B already won.
    resolveA(jsonResponse(200, { asset: assetA, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(within(screen.getByRole("region", { name: "에셋 상세" })).getByText("나중에 연 에셋")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "에셋 상세" })).queryByText("먼저 연 에셋")).toBeNull();
  });

  it("closes the stale detail and shows a distinct detail error when a newer detail request fails", async () => {
    const assetA = makeAsset({ assetId: "ASSET-A", displayName: "성공한 에셋" });
    const assetB = makeAsset({ assetId: "ASSET-B", displayName: "실패할 에셋" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA, assetB] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetA, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "ASSET_STORAGE_ERROR", message: "internal detail" }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("성공한 에셋"));
    await screen.findByRole("region", { name: "에셋 상세" });

    fireEvent.click(within(list).getByText("실패할 에셋"));

    await waitFor(() => expect(screen.queryByRole("region", { name: "에셋 상세" })).toBeNull());
    const detailError = await screen.findByTestId("asset-detail-error");
    expect(detailError.textContent).toBe("에셋을 저장하거나 읽지 못했습니다.");
  });

  it("does not let a deferred edit response overwrite a different asset opened afterward", async () => {
    const assetA = makeAsset({ assetId: "ASSET-A", displayName: "편집 대상" });
    const assetB = makeAsset({ assetId: "ASSET-B", displayName: "다른 에셋" });
    let resolveEdit: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA, assetB] })) // initial list
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetA, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })) // open A
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveEdit = resolve; })) // PATCH pending
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetB, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })) // open B
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA, assetB] })); // list refresh after edit resolves
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("편집 대상"));
    await screen.findByRole("region", { name: "에셋 상세" });

    const form = editForm();
    fireEvent.change(within(form).getByLabelText("이름"), { target: { value: "바뀐 이름" } });
    fireEvent.click(within(form).getByRole("button", { name: "변경 저장" }));

    // Navigate to a different asset before the edit's PATCH resolves.
    fireEvent.click(within(list).getByText("다른 에셋"));
    await waitFor(() => expect(within(detailRegion()).getByText("다른 에셋")).toBeTruthy());

    resolveEdit(jsonResponse(200, { asset: { ...assetA, displayName: "바뀐 이름" } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(within(detailRegion()).getByText("다른 에셋")).toBeTruthy();
    expect(within(detailRegion()).queryByText("바뀐 이름")).toBeNull();
  });

  it("does not let a deferred delete close a different asset opened afterward", async () => {
    const assetA = makeAsset({ assetId: "ASSET-A", displayName: "삭제 대상" });
    const assetB = makeAsset({ assetId: "ASSET-B", displayName: "다른 에셋" });
    let resolveDelete: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA, assetB] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetA, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveDelete = resolve; }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetB, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetB] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("삭제 대상"));
    await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detailRegion()).getByRole("button", { name: "목록에서 삭제" }));
    confirmPanelProceed();

    // Navigate to a different asset before the delete resolves.
    fireEvent.click(within(list).getByText("다른 에셋"));
    await waitFor(() => expect(within(detailRegion()).getByText("다른 에셋")).toBeTruthy());

    resolveDelete(jsonResponse(200, { assetId: "ASSET-A", deletedOwnedFile: false }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole("region", { name: "에셋 상세" })).toBeTruthy();
    expect(within(detailRegion()).getByText("다른 에셋")).toBeTruthy();
  });

  it("does not auto-open the newly created asset if the user opened a different asset while import was pending", async () => {
    const assetA = makeAsset({ assetId: "ASSET-A", displayName: "항목 A" });
    const assetB = makeAsset({ assetId: "ASSET-B", displayName: "항목 B" });
    const created = makeAsset({ assetId: "ASSET-CREATED", displayName: "새 캐릭터" });
    let resolveCreate: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA, assetB] })) // initial list
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveCreate = resolve; })) // create: pending
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetB, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })) // open B while import is pending
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA, assetB, created] })); // list refresh after import resolves
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });

    const file = new File(["binary-bytes"], "cat.png", { type: "image/png" });
    await fillAndSubmitImport(file, "새 캐릭터");

    // The user opens a different asset before the pending import's create request resolves.
    fireEvent.click(within(list).getByText("항목 B"));
    await waitFor(() => expect(within(detailRegion()).getByText("항목 B")).toBeTruthy());

    resolveCreate(jsonResponse(200, { asset: created }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4)); // list still refreshes; no 5th auto-open request

    expect(within(detailRegion()).getByText("항목 B")).toBeTruthy();
    expect(within(detailRegion()).queryByText("새 캐릭터")).toBeNull();
  });

  it("does not let a deferred import's list refresh replace a newer explicit search's results, but still auto-opens the created asset", async () => {
    const assetA = makeAsset({ assetId: "ASSET-A", displayName: "원본 항목" });
    const newerResult = makeAsset({ assetId: "ASSET-NEW", displayName: "새로운 검색 결과" });
    const created = makeAsset({ assetId: "ASSET-CREATED", displayName: "새 캐릭터" });
    let resolveCreate: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA] })) // initial list
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveCreate = resolve; })) // create: pending
      .mockResolvedValueOnce(jsonResponse(200, { assets: [newerResult] })) // explicit newer search while import is pending
      .mockResolvedValueOnce(jsonResponse(200, { asset: created, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })); // auto-open after import resolves
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("원본 항목");

    const file = new File(["binary-bytes"], "cat.png", { type: "image/png" });
    await fillAndSubmitImport(file, "새 캐릭터");

    const search = searchForm();
    fireEvent.change(within(search).getByLabelText("검색"), { target: { value: "새 검색" } });
    fireEvent.click(within(search).getByRole("button", { name: "검색" }));
    await screen.findByText("새로운 검색 결과");

    resolveCreate(jsonResponse(200, { asset: created }));
    await waitFor(() => expect(within(detailRegion()).getByText("새 캐릭터")).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledTimes(4); // no stale extra list reload with the pre-search query
    expect(screen.getByText("새로운 검색 결과")).toBeTruthy();
  });

  it("does not let a deferred edit's list refresh replace a newer explicit search's results", async () => {
    const assetA = makeAsset({ assetId: "ASSET-A", displayName: "편집 대상" });
    const assetB = makeAsset({ assetId: "ASSET-B", displayName: "다른 목록 항목" });
    const newerResult = makeAsset({ assetId: "ASSET-NEW", displayName: "새로운 검색 결과" });
    let resolveEdit: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA, assetB] })) // initial list
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetA, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })) // open A
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveEdit = resolve; })) // PATCH: pending
      .mockResolvedValueOnce(jsonResponse(200, { assets: [newerResult] })); // explicit newer search while edit is pending
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("편집 대상"));
    await screen.findByRole("region", { name: "에셋 상세" });

    const form = editForm();
    fireEvent.change(within(form).getByLabelText("이름"), { target: { value: "바뀐 이름" } });
    fireEvent.click(within(form).getByRole("button", { name: "변경 저장" }));

    const search = searchForm();
    fireEvent.change(within(search).getByLabelText("검색"), { target: { value: "새 검색" } });
    fireEvent.click(within(search).getByRole("button", { name: "검색" }));
    await screen.findByText("새로운 검색 결과");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    resolveEdit(jsonResponse(200, { asset: { ...assetA, displayName: "바뀐 이름" } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(4); // the edit's completion must not issue a stale extra list refresh
    expect(screen.getByText("새로운 검색 결과")).toBeTruthy();
    expect(screen.queryByText("다른 목록 항목")).toBeNull();
  });

  it("does not let a deferred delete's list refresh replace a newer explicit search's results", async () => {
    const assetA = makeAsset({ assetId: "ASSET-A", displayName: "삭제 대상" });
    const assetB = makeAsset({ assetId: "ASSET-B", displayName: "다른 목록 항목" });
    const newerResult = makeAsset({ assetId: "ASSET-NEW", displayName: "새로운 검색 결과" });
    let resolveDelete: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [assetA, assetB] })) // initial list
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetA, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })) // open A
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveDelete = resolve; })) // DELETE: pending
      .mockResolvedValueOnce(jsonResponse(200, { assets: [newerResult] })); // explicit newer search while delete is pending
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("삭제 대상"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByRole("button", { name: "목록에서 삭제" }));
    confirmPanelProceed();

    const search = searchForm();
    fireEvent.change(within(search).getByLabelText("검색"), { target: { value: "새 검색" } });
    fireEvent.click(within(search).getByRole("button", { name: "검색" }));
    await screen.findByText("새로운 검색 결과");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    resolveDelete(jsonResponse(200, { assetId: "ASSET-A", deletedOwnedFile: false }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(4); // the delete's completion must not issue a stale extra list refresh
    expect(screen.getByText("새로운 검색 결과")).toBeTruthy();
  });

  it("keeps the previously successful list visible when a later search fails, and shows the error alongside it", async () => {
    const asset = makeAsset({ assetId: "ASSET-1", displayName: "유지되어야 하는 항목" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "ASSET_JSON_MALFORMED", message: "internal parse detail" }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("유지되어야 하는 항목");

    fireEvent.click(searchForm().querySelector('button[type="submit"]') as HTMLElement);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("에셋 목록 파일을 읽을 수 없습니다.");
    expect(screen.getByText("유지되어야 하는 항목")).toBeTruthy();
  });

  it("never issues a request to a provider, video, or FFmpeg-related route", async () => {
    const asset = makeAsset({ assetId: "ASSET-1", displayName: "항목" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("항목"));
    await screen.findByRole("region", { name: "에셋 상세" });

    for (const [url] of fetchMock.mock.calls as Array<[string]>) {
      expect(url).toMatch(/^\/assets/);
      expect(url).not.toContain("/settings/providers");
      expect(url).not.toContain("/videos/");
    }
  });

  it("adds a new version to the selected asset via multipart upload, refreshing its detail and version list", async () => {
    const asset = makeAsset({ assetId: "ASSET-VER", displayName: "버전 관리 대상", versions: [{ version: 1, contentSha256: "a".repeat(64), createdAt: "2026-08-21T00:00:00.000Z", notes: "" }] });
    const versioned = { ...asset, version: 2, versions: [...asset.versions, { version: 2, contentSha256: "b".repeat(64), createdAt: "2026-08-22T00:00:00.000Z", notes: "재촬영" }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: versioned }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [versioned] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("버전 관리 대상"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const versionRegion = within(detail).getByRole("region", { name: "버전 기록" });
    const form = within(versionRegion).getByRole("form", { name: "새 버전 추가" });

    const file = new File(["v2-bytes"], "v2.png", { type: "image/png" });
    fireEvent.change(within(form).getByLabelText("새 버전 이미지"), { target: { files: [file] } });
    fireEvent.change(within(form).getByLabelText("메모"), { target: { value: "재촬영" } });
    fireEvent.click(within(form).getByRole("button", { name: "새 버전 추가" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/assets/ASSET-VER/versions");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("image")).toBe(file);
    expect(body.get("notes")).toBe("재촬영");
    expect(within(versionRegion).getByText(/v2 \(현재\)/)).toBeTruthy();
  });

  it("relinks the current version's file only after explicit confirmation", async () => {
    const asset = makeAsset({ assetId: "ASSET-RELINK", displayName: "재연결 대상" });
    const relinked = { ...asset, contentSha256: "c".repeat(64) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: relinked }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [relinked] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("재연결 대상"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const versionRegion = within(detail).getByRole("region", { name: "버전 기록" });
    const form = within(versionRegion).getByRole("form", { name: "파일 재연결" });

    const file = new File(["replacement-bytes"], "replacement.png", { type: "image/png" });
    fireEvent.change(within(form).getByLabelText("교체 이미지"), { target: { files: [file] } });
    fireEvent.click(within(form).getByRole("button", { name: "현재 버전 재연결" }));

    const panel = await screen.findByTestId("asset-confirm-panel");
    expect(panel.textContent).toContain("재연결 대상");
    fireEvent.click(within(panel).getByRole("button", { name: "네, 진행합니다" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/assets/ASSET-RELINK/relink");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("image")).toBe(file);
  });

  it("does not relink when the confirmation dialog is cancelled", async () => {
    const asset = makeAsset({ assetId: "ASSET-RELINK", displayName: "재연결 대상" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("재연결 대상"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const form = within(within(detail).getByRole("region", { name: "버전 기록" })).getByRole("form", { name: "파일 재연결" });
    fireEvent.change(within(form).getByLabelText("교체 이미지"), { target: { files: [new File(["x"], "x.png", { type: "image/png" })] } });
    fireEvent.click(within(form).getByRole("button", { name: "현재 버전 재연결" }));
    confirmPanelCancel();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("runs a file audit and shows classification results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, {
        entries: [
          { assetId: "ASSET-1", displayName: "정상 에셋", classification: "healthy", sourceKind: "manual", message: "" },
          { assetId: "ASSET-2", displayName: "누락 에셋", classification: "missing", sourceKind: "project", message: "파일이 존재하지 않습니다" },
        ],
      }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByTestId("asset-maintenance-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "점검 실행" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/assets/audit");
    const auditList = await screen.findByRole("list", { name: "파일 상태 목록" });
    expect(within(auditList).getByText(/정상 에셋/).textContent).toContain("정상");
    expect(within(auditList).getByText(/누락 에셋/).textContent).toContain("파일 없음");
  });

  it("deletes an Asset's owned file only via the explicit owned-file action, distinct from the index-only delete", async () => {
    const asset = makeAsset({ assetId: "ASSET-OWNED", displayName: "원본 삭제 대상" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { assetId: "ASSET-OWNED", deletedOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("원본 삭제 대상"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByRole("button", { name: "에셋과 원본 파일 함께 삭제" }));

    const panel = await screen.findByTestId("asset-confirm-panel");
    expect(panel.textContent).toContain("원본 삭제 대상");
    fireEvent.click(within(panel).getByRole("button", { name: "네, 진행합니다" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/assets/ASSET-OWNED/owned-file");
    expect(init.method).toBe("DELETE");
    await waitFor(() => expect(screen.queryByRole("region", { name: "에셋 상세" })).toBeNull());
  });

  it("does not offer owned-file deletion when the backend reports it is unsafe", async () => {
    const asset = makeAsset({ assetId: "ASSET-SHARED", displayName: "공유된 원본" });
    vi.stubGlobal("fetch", withGeneratedImages(vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false }))));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("공유된 원본"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    expect(within(detail).queryByRole("button", { name: "에셋과 원본 파일 함께 삭제" })).toBeNull();
  });

  it("runs the legacy reference migration and reports its result, refreshing the list only when something migrated", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { projectsScanned: 3, migratedAssets: 2, deduplicatedAssets: 1, failedAssets: 0 }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [makeAsset({ assetId: "ASSET-LEGACY", displayName: "이전된 에셋" })] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByTestId("asset-maintenance-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "일괄 이전 실행" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/assets/legacy-migration");
    expect(init.method).toBe("POST");
    const result = await screen.findByTestId("legacy-migration-result");
    expect(result.textContent).toContain("프로젝트 3개 확인");
    expect(result.textContent).toContain("2개 이전");
    expect(await screen.findByText("이전된 에셋")).toBeTruthy();
  });

  // It used to be a third child of a two-column grid, which put it on a second row under the narrow left
  // column — below a list that scrolls to 560px, so you had to already know it was there. Document order is
  // what "you see it without looking for it" reduces to in a test, so that is what is asserted; a rule about
  // pixels would pass on a page where the section had been pushed off the bottom again.
  it("puts the made-images section ahead of the asset list, not below it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { assets: [makeAsset({ assetId: "ASSET-1", displayName: "어떤 에셋" })] }));
    vi.stubGlobal("fetch", answerOutOfBand({
      "GET /images/generated": {
        projects: [{ projectId: "1", projectTitle: "단편 하나", sceneNumber: 1, updatedAt: "2026-08-29T00:00:00.000Z" }],
        episodes: [],
      },
    }, fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByRole("list", { name: "에셋 목록" });

    const made = await screen.findByTestId("generated-images");
    const list = screen.getByRole("list", { name: "에셋 목록" });
    const maintenance = screen.getByTestId("asset-maintenance-toggle");
    // Node.DOCUMENT_POSITION_FOLLOWING (4): the argument comes after `made` in the document.
    expect(made.compareDocumentPosition(list) & 4).toBe(4);
    expect(made.compareDocumentPosition(maintenance) & 4).toBe(4);
  });

  // The Episode this exists for (12/Episode01) is finished: its pictures are on disk and nothing it will ever
  // do again would index them, because the repair only ran on approve and regenerate. So the button is the
  // only way that Episode's folder appears — which makes "the list actually refreshed" part of the assertion,
  // not just "a number was printed".
  it("registers scene images that were never indexed and shows the newly registered folder", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { scanned: 3, registered: 1, skipped: 2, failed: 0 }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [makeAsset({ assetId: "ASSET-EP1", displayName: "12/Episode01 generated images" })] }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByTestId("asset-maintenance-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "등록 실행" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/assets/backfill-generated-images");
    expect(init.method).toBe("POST");
    const result = await screen.findByTestId("backfill-result");
    expect(result.textContent).toContain("3개 확인");
    expect(result.textContent).toContain("1개 등록");
    expect(await screen.findByText("12/Episode01 generated images")).toBeTruthy();
  });

  it("does not refresh the list when everything was already registered", async () => {
    // Running it twice is expected — the button says it is safe to. A reload on the second run would drop a
    // selection the person is holding, in order to redraw rows that did not change.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { scanned: 3, registered: 0, skipped: 3, failed: 0 }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByTestId("asset-maintenance-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "등록 실행" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByTestId("backfill-result");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // A failure here is a scene file that cannot be read, so the next press reads the same unreadable file. The
  // count alone reads like something a retry clears, which is why the sentence is asserted separately — and
  // asserted absent on a clean run, or it would be a permanent warning about nothing.
  it("says a failed registration will not be fixed by pressing again, and stays quiet when nothing failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { scanned: 3, registered: 1, skipped: 1, failed: 1 }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { scanned: 3, registered: 0, skipped: 3, failed: 0 }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByTestId("asset-maintenance-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "등록 실행" }));

    const note = await screen.findByTestId("backfill-failed-note");
    expect(note.textContent).toContain("다시 눌러도");

    fireEvent.click(screen.getByRole("button", { name: "등록 실행" }));
    await waitFor(() => expect(screen.queryByTestId("backfill-failed-note")).toBeNull());
  });

  it("shows a fixed, safe error when the registration request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "ASSET_STORAGE_ERROR", message: "internal detail" }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByTestId("asset-maintenance-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "등록 실행" }));

    const alert = await screen.findByTestId("backfill-error");
    expect(alert.textContent).toBe("에셋을 저장하거나 읽지 못했습니다.");
    expect(alert.textContent).not.toContain("internal detail");
  });

  it("does not refresh the list when the legacy reference migration finds nothing to migrate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { projectsScanned: 1, migratedAssets: 0, deduplicatedAssets: 0, failedAssets: 0 }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByTestId("asset-maintenance-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "일괄 이전 실행" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByTestId("legacy-migration-result");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a fixed, safe error when the legacy reference migration request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "ASSET_STORAGE_ERROR", message: "internal detail" }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByTestId("asset-maintenance-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "일괄 이전 실행" }));

    const alert = await screen.findByTestId("legacy-migration-error");
    expect(alert.textContent).toBe("에셋을 저장하거나 읽지 못했습니다.");
  });

  it("deletes a Folder with the default (index-only) option, distinct from the deletion UI shown for a regular asset", async () => {
    const first = makeAsset({ assetId: "CHAR-1", assetType: "character", displayName: "Front", parentFolderId: "FOLDER-CHAR", sortOrder: 0 });
    const folder = makeAsset({ assetId: "FOLDER-CHAR", assetType: "character", displayName: "Hero references", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: ["CHAR-1"], thumbnailAssetId: "CHAR-1" });
    // Routed by URL, not call order — the per-child getAsset() effect adds an extra request
    // (GET /assets/CHAR-1) beyond the plain list/detail/delete/reload sequence.
    const fetchMock = stubFetchByRoute({
      "GET /assets": [{ assets: [folder, first] }, { assets: [first] }],
      "GET /assets/FOLDER-CHAR": { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false },
      "GET /assets/CHAR-1": { asset: first, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "DELETE /assets/FOLDER-CHAR/folder": { assetId: "FOLDER-CHAR", removedChildAssetIds: [], deletedFiles: 0 },
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("Hero references"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    expect(within(detail).queryByRole("button", { name: "목록에서 삭제" })).toBeNull();
    const folderDeleteSection = within(detail).getByRole("region", { name: "폴더 삭제" });

    fireEvent.click(within(folderDeleteSection).getByRole("button", { name: "폴더 삭제" }));

    const panel = await screen.findByTestId("asset-confirm-panel");
    expect(panel.textContent).toContain("Hero references");
    fireEvent.click(within(panel).getByRole("button", { name: "네, 진행합니다" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/assets/FOLDER-CHAR/folder" && (init as RequestInit | undefined)?.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("region", { name: "에셋 상세" })).toBeNull());
  });

  it("deletes a Folder together with its child indexes and owned files when both options are selected", async () => {
    const first = makeAsset({ assetId: "CHAR-1", assetType: "character", displayName: "Front", parentFolderId: "FOLDER-CHAR", sortOrder: 0 });
    const folder = makeAsset({ assetId: "FOLDER-CHAR", assetType: "character", displayName: "Hero references", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: ["CHAR-1"], thumbnailAssetId: "CHAR-1" });
    const fetchMock = stubFetchByRoute({
      "GET /assets": [{ assets: [folder, first] }, { assets: [] }],
      "GET /assets/FOLDER-CHAR": { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false },
      "GET /assets/CHAR-1": { asset: first, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "DELETE /assets/FOLDER-CHAR/folder?removeChildIndexes=true&deleteManualFiles=true": { assetId: "FOLDER-CHAR", removedChildAssetIds: ["CHAR-1"], deletedFiles: 1 },
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("Hero references"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const folderDeleteSection = within(detail).getByRole("region", { name: "폴더 삭제" });
    fireEvent.click(within(folderDeleteSection).getByLabelText("하위 항목의 원본 파일도 함께 삭제(수동 등록 항목만 가능)"));
    expect((within(folderDeleteSection).getByLabelText("하위 항목 색인도 함께 삭제") as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(folderDeleteSection).getByRole("button", { name: "폴더 삭제" }));
    confirmPanelProceed();

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).startsWith("/assets/FOLDER-CHAR/folder?") && (init as RequestInit | undefined)?.method === "DELETE")).toBe(true));
    const [url] = fetchMock.mock.calls.find(([callUrl, init]) => String(callUrl).startsWith("/assets/FOLDER-CHAR/folder?") && (init as RequestInit | undefined)?.method === "DELETE")! as [string];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.get("removeChildIndexes")).toBe("true");
    expect(parsed.searchParams.get("deleteManualFiles")).toBe("true");
  });

  it("does not delete a Folder when the confirmation dialog is cancelled", async () => {
    const folder = makeAsset({ assetId: "FOLDER-CHAR", assetType: "character", displayName: "Hero references", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: [], thumbnailAssetId: "" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [folder] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false }));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("Hero references"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(within(detail).getByRole("region", { name: "폴더 삭제" })).getByRole("button", { name: "폴더 삭제" }));
    confirmPanelCancel();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates a folder of any asset type with a common description, then opens it without the character-only role selector", async () => {
    const folder = makeAsset({ assetId: "FOLDER-BG", assetType: "background", displayName: "숲 배경", description: "밤의 대나무 숲", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: [], thumbnailAssetId: "" });
    const fetchMock = stubFetchByRoute({
      "GET /assets": [{ assets: [] }, { assets: [folder] }],
      "POST /assets/folders": { asset: folder },
      "GET /assets/FOLDER-BG": { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false },
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByTestId("folder-create-toggle"));
    const form = screen.getByRole("form", { name: "폴더 만들기" });
    fireEvent.change(within(form).getByLabelText("폴더 이름"), { target: { value: "숲 배경" } });
    fireEvent.change(within(form).getByLabelText("폴더 유형"), { target: { value: "background" } });
    fireEvent.change(within(form).getByLabelText("공통 특징(선택)"), { target: { value: "밤의 대나무 숲" } });
    fireEvent.click(within(form).getByRole("button", { name: "폴더 만들기" }));

    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const createCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/assets/folders" && (init as RequestInit | undefined)?.method === "POST")! as [string, RequestInit];
    expect(JSON.parse(String(createCall[1].body))).toEqual({ assetType: "background", displayName: "숲 배경", description: "밤의 대나무 숲" });
    // Non-character folders render the composition region but never the character-only role selector.
    const set = within(detail).getByRole("region", { name: "폴더 구성" });
    expect(within(set).queryByLabelText("역할")).toBeNull();
  });

  it("saves a child's individual description from the folder composition list, only when it differs from the saved value", async () => {
    const child = makeAsset({ assetId: "CHAR-1", assetType: "character", displayName: "Front", description: "", parentFolderId: "FOLDER-CHAR", sortOrder: 0 });
    const folder = makeAsset({ assetId: "FOLDER-CHAR", assetType: "character", displayName: "Hero references", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: ["CHAR-1"], thumbnailAssetId: "CHAR-1" });
    const updatedChild = { ...child, description: "정면, 웃는 표정" };
    const fetchMock = stubFetchByRoute({
      "GET /assets": { assets: [folder, child] },
      "GET /assets/FOLDER-CHAR": { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false },
      "GET /assets/CHAR-1": { asset: child, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "PATCH /assets/CHAR-1": { asset: updatedChild },
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("Hero references"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const set = within(detail).getByRole("region", { name: "폴더 구성" });
    await waitFor(() => expect(within(set).getByLabelText("개별 특징")).toBeTruthy());

    const saveButton = screen.getByTestId("child-description-save-CHAR-1");
    expect(saveButton).toBeDisabled(); // no edit yet — nothing to save
    fireEvent.change(within(set).getByLabelText("개별 특징"), { target: { value: "정면, 웃는 표정" } });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/assets/CHAR-1" && (init as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const [, patchInit] = fetchMock.mock.calls.find(([url, init]) => String(url) === "/assets/CHAR-1" && (init as RequestInit | undefined)?.method === "PATCH")! as [string, RequestInit];
    expect(JSON.parse(String(patchInit.body))).toEqual({ description: "정면, 웃는 표정" });
    await waitFor(() => expect((within(set).getByLabelText("개별 특징") as HTMLInputElement).value).toBe("정면, 웃는 표정"));
    expect(screen.getByTestId("child-description-save-CHAR-1")).toBeDisabled(); // draft consumed after save
  });

  it("registers a brand-new image straight into the open folder, then refiles it under that folder", async () => {
    const folder = makeAsset({ assetId: "FOLDER-CHAR", assetType: "character", displayName: "주인공", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: [], thumbnailAssetId: "" });
    const created = makeAsset({ assetId: "CHAR-NEW", assetType: "character", displayName: "정면", description: "웃는 표정" });
    const filed = { ...created, parentFolderId: "FOLDER-CHAR" };
    const folderWithChild = { ...folder, childAssetIds: ["CHAR-NEW"] };
    const fetchMock = stubFetchByRoute({
      "GET /assets": [{ assets: [folder] }, { assets: [folderWithChild, filed] }],
      "GET /assets/FOLDER-CHAR": [
        { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false },
        { asset: folderWithChild, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false },
      ],
      "GET /assets/CHAR-NEW": { asset: filed, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
      "POST /assets": { asset: created },
      "PATCH /assets/CHAR-NEW/parent-folder": { asset: filed },
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("주인공"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });

    const uploadForm = within(detail).getByRole("form", { name: "이 폴더에 새 이미지 등록" });
    fireEvent.change(within(uploadForm).getByLabelText("이미지 파일"), { target: { files: [new File(["x"], "front.png", { type: "image/png" })] } });
    fireEvent.change(within(uploadForm).getByLabelText("이름"), { target: { value: "정면" } });
    fireEvent.change(within(uploadForm).getByLabelText("새 이미지의 개별 특징"), { target: { value: "웃는 표정" } });
    fireEvent.click(within(uploadForm).getByRole("button", { name: "이 폴더에 등록" }));

    // Creation and filing are separate endpoints — the point of this screen is that one click does both.
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/assets/CHAR-NEW/parent-folder" && (init as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const [, patchInit] = fetchMock.mock.calls.find(([url, init]) => String(url) === "/assets/CHAR-NEW/parent-folder" && (init as RequestInit | undefined)?.method === "PATCH")! as [string, RequestInit];
    expect(JSON.parse(String(patchInit.body))).toEqual({ parentFolderId: "FOLDER-CHAR" });
  });

  it("says the image survived when only the filing half failed, so nobody hunts for a file they think vanished", async () => {
    const folder = makeAsset({ assetId: "FOLDER-CHAR", assetType: "character", displayName: "주인공", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: [], thumbnailAssetId: "" });
    const created = makeAsset({ assetId: "CHAR-NEW", assetType: "character", displayName: "정면" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/assets" && method === "GET") return jsonResponse(200, { assets: [folder] });
      if (url === "/assets/FOLDER-CHAR" && method === "GET") return jsonResponse(200, { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false });
      if (url === "/assets" && method === "POST") return jsonResponse(200, { asset: created });
      if (url === "/assets/CHAR-NEW/parent-folder") return jsonResponse(500, { code: "ASSET_MUTATION_UNSUPPORTED", message: "수정할 수 없습니다." });
      throw new Error(`Unexpected fetch call in test: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("주인공"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });

    const uploadForm = within(detail).getByRole("form", { name: "이 폴더에 새 이미지 등록" });
    fireEvent.change(within(uploadForm).getByLabelText("이미지 파일"), { target: { files: [new File(["x"], "front.png", { type: "image/png" })] } });
    fireEvent.change(within(uploadForm).getByLabelText("이름"), { target: { value: "정면" } });
    fireEvent.click(within(uploadForm).getByRole("button", { name: "이 폴더에 등록" }));

    const failure = await screen.findByTestId("folder-mutation-error");
    expect(failure.textContent).toContain("등록됐지만");
    expect(failure.textContent).toContain("정면");
  });

  it("warns that a loose character image will never reach a project's cast list", async () => {
    vi.stubGlobal("fetch", withGeneratedImages(vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] }))));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    const form = importForm();
    expect(screen.queryByTestId("loose-character-hint")).toBeNull();
    fireEvent.change(within(form).getByLabelText("유형"), { target: { value: "character" } });
    expect(screen.getByTestId("loose-character-hint").textContent).toContain("폴더");
  });

  it("calls onBack when the back button is clicked", async () => {
    vi.stubGlobal("fetch", withGeneratedImages(vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] }))));
    const onBack = vi.fn();
    render(<AssetLibraryScreen onBack={onBack} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 목록으로" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirmation open and explains the refusal where the button was pressed", async () => {
    // A rejected folder delete used to close the panel and write the reason into the detail-level slot near
    // the top of a very long pane — far above the fold. The dialog vanished, the folder stayed, and it read as
    // a dead button. The reason has to land next to the button that was just pressed.
    const child = makeAsset({ assetId: "GEN-1", displayName: "생성된 이미지", parentFolderId: "FOLDER-GEN", sortOrder: 0 });
    const folder = makeAsset({
      assetId: "FOLDER-GEN", displayName: "생성 이미지 모음", isFolder: true, imageAvailable: false,
      contentSha256: "", versions: [], referenceImages: [], childAssetIds: ["GEN-1"], thumbnailAssetId: "GEN-1",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "DELETE") return jsonResponse(409, { code: "ASSET_MUTATION_UNSUPPORTED", message: "raw backend detail" });
      if (url === "/assets") return jsonResponse(200, { assets: [folder, child] });
      if (url === "/assets/FOLDER-GEN") return jsonResponse(200, { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false });
      return jsonResponse(200, { asset: child, usageProjectIds: [], ownership: "project_generated", canDeleteOwnedFile: false });
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("생성 이미지 모음"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const folderDeleteSection = within(detail).getByRole("region", { name: "폴더 삭제" });
    fireEvent.click(within(folderDeleteSection).getByLabelText("하위 항목의 원본 파일도 함께 삭제(수동 등록 항목만 가능)"));
    fireEvent.click(within(folderDeleteSection).getByRole("button", { name: "폴더 삭제" }));
    confirmPanelProceed();

    const shown = await screen.findByTestId("asset-confirm-error");
    // Names the actual rule instead of the generic "이 에셋은 현재 수정할 수 없습니다", and says what to undo.
    expect(shown.textContent).toContain("직접 등록하지 않은 항목");
    expect(shown.textContent).toContain("원본 파일도 함께 삭제");
    expect(shown.textContent).not.toContain("raw backend detail");
    // The panel stays put so the failure is visible at all, and the folder is still there.
    expect(screen.getByTestId("asset-confirm-panel")).toBeTruthy();
    expect(screen.getByRole("region", { name: "에셋 상세" })).toBeTruthy();
    expect(within(screen.getByTestId("asset-confirm-panel")).getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it("shows a refused plain folder delete without inventing the manual-files reason", async () => {
    const folder = makeAsset({
      assetId: "FOLDER-USED", displayName: "사용 중 폴더", isFolder: true, imageAvailable: false,
      contentSha256: "", versions: [], referenceImages: [], childAssetIds: [], thumbnailAssetId: "",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "DELETE") return jsonResponse(409, { code: "ASSET_MUTATION_UNSUPPORTED", message: "raw" });
      if (String(input) === "/assets") return jsonResponse(200, { assets: [folder] });
      return jsonResponse(200, { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false });
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("사용 중 폴더"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(within(detail).getByRole("region", { name: "폴더 삭제" })).getByRole("button", { name: "폴더 삭제" }));
    confirmPanelProceed();

    // Without the owned-files option the manual-library rule is not what refused it, so the specific sentence
    // would be a guess. The safe mapped message is shown instead.
    const shown = await screen.findByTestId("asset-confirm-error");
    expect(shown.textContent).toBe("이 에셋은 현재 수정할 수 없습니다.");
  });
});

function _unusedTypeCheck(asset: Asset, response: GetAssetResponse): void {
  void asset;
  void response;
}
void _unusedTypeCheck;

/**
 * 서버에서 세고 들어간 세 가지. 숫자는 캡틴D의 실제 보관함에서 읽은 것입니다 —
 * 폴더 19개 중 **15개가 프로젝트가 만든 것**, 사람이 만든 건 4개, 그리고 그 15개 이름이 **전부**
 * ` generated images` 로 끝났고, 목록 19줄 중 **15줄이 📁** 였습니다.
 */
describe("AssetLibraryScreen list rows", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops the words every project folder's name repeats", () => {
    const projectFolder = makeAssetFolder({
      assetId: "F-1", displayName: "12/Episode01 generated images", sourceProjectId: "12",
    });
    expect(assetListName(projectFolder)).toBe("12/Episode01");
  });

  it("leaves a name a person chose alone, even that one", () => {
    // 🔴 무리 이름이 대신 말해 주는 건 **프로젝트가 만든** 폴더뿐입니다. 사람이 손으로 그렇게 지었다면
    // 그건 그 사람의 선택이고, 화면이 고쳐 줄 자리가 아닙니다.
    const mine = makeAssetFolder({ assetId: "F-2", displayName: "my generated images" });
    expect(assetListName(mine)).toBe("my generated images");
  });

  it("puts a folder's own picture on its row", () => {
    // 폴더는 자기 그림이 없고 `thumbnailAssetId` 로 안에 든 한 장을 가리킵니다.
    const folder = makeAssetFolder({ assetId: "F-3", thumbnailAssetId: "CHILD-1" });
    expect(coverUrl(folder)).toBe("/assets/CHILD-1/content");
  });

  it("invents nothing for a folder that has no picture yet", () => {
    // 🟠 이 반쪽이 없으면 위의 짝은 「폴더면 늘 주소를 만든다」는 구현으로도 초록입니다 — 그러면 빈 폴더가
    // 깨진 그림으로 나옵니다.
    const empty = makeAssetFolder({ assetId: "F-4", thumbnailAssetId: "" });
    expect(coverUrl(empty)).toBeNull();
  });

  it("sorts my own folders away from the ones projects made", async () => {
    const response: ListAssetsResponse = {
      assets: [
        // 🔴 `makeAsset({ isFolder: true })` 는 폴더가 **아닙니다** — 진짜 digest 와 `imageAvailable: true` 를
        // 그대로 안고 와서 응답 검증기가 malformed 로 거절하고, 화면에는 목록 대신 오류 배너가 뜹니다.
        // `testUtils.ts` 의 `makeAssetFolder` 주석이 이 증상까지 이름으로 적어 두고 있었습니다 (CLI Round 981).
        makeAssetFolder({ assetId: "F-P", displayName: "꽃말_개나리 generated images", sourceProjectId: "꽃말_개나리" }),
        makeAssetFolder({ assetId: "F-M", displayName: "아리" }),
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    // 🔴 `getAllByRole("listitem")` 은 무리 머리글을 **안 돌려줍니다** — 그 줄은 `role="presentation"` 이라
    // 접근성 트리에서 빠져 있고, 그게 맞습니다. 머리글은 에셋이 아니고, 스크린 리더가 「항목 넷」이라고
    // 읽으면 안 됩니다. 이 짝이 주장하는 건 **「섞이지 않는다」 = 순서**라서 DOM 순서 그대로 읽습니다
    // (CLI Round 983).
    const rows = Array.from(list.children).map((item) => item.textContent ?? "");
    expect(rows[0], "사람이 정리해 둔 것이 먼저입니다").toContain("내 폴더 · 1");
    expect(rows[1]).toContain("아리");
    expect(rows[2]).toContain("프로젝트가 만든 폴더 · 1");
    expect(rows[3]).toContain("꽃말_개나리");
  });
});

/**
 * 2/2 — 되풀이되던 줄 설명과 흩어져 있던 숫자.
 *
 * 🟠 여기서는 **화면까지 가는 짝을 하나만** 둡니다. 나머지는 순수 함수를 직접 부릅니다 — 981·983 에서
 * 제가 못 돌리는 구간에서 두 번 넘어졌고, 그 구간을 좁히는 쪽이 낫습니다.
 */
describe("AssetLibraryScreen counts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says how many are inside instead of repeating the group's own name", () => {
    // 🔴 전에는 프로젝트가 만든 폴더 15줄이 전부 「프로젝트 폴더」였습니다 — 머리글이 방금 한 말입니다.
    const folder = makeAssetFolder({ assetId: "F-1", sourceProjectId: "12", childAssetIds: ["A", "B", "C"] });
    expect(rowSubtitle(folder)).toBe("이미지 3장");
  });

  it("keeps the kind on my own folder, because no heading says it there", () => {
    const mine = makeAssetFolder({ assetId: "F-2", assetType: "background", childAssetIds: ["A"] });
    expect(rowSubtitle(mine)).toBe("배경 · 이미지 1장");
  });

  it("leaves a row that is not a folder as it was", () => {
    // 🟠 이 반쪽이 없으면 위의 둘은 「모든 줄에 장수를 적는다」는 구현으로도 초록입니다 — 그러면 이미지
    // 한 장짜리 줄이 「이미지 0장」이라고 말합니다.
    expect(rowSubtitle(makeAsset({ assetId: "A-1", assetType: "character" }))).toBe("캐릭터");
  });

  it("puts what the library holds in one line, and leaves the reason at the bottom", async () => {
    const response: ListAssetsResponse = {
      assets: [
        makeAssetFolder({ assetId: "F-1", displayName: "아리", childAssetIds: ["A-1", "A-2"] }),
        makeAsset({ assetId: "A-1", displayName: "정면", parentFolderId: "F-1" }),
        makeAsset({ assetId: "A-2", displayName: "옆모습", parentFolderId: "F-1" }),
      ],
    };
    vi.stubGlobal("fetch", withGeneratedImages(vi.fn().mockResolvedValue(jsonResponse(200, response))));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const count = await screen.findByTestId("asset-library-count");
    expect(count.textContent, "폴더 수와 그 안의 장수가 한 줄에").toContain("폴더 1");
    expect(count.textContent).toContain("그 안의 이미지 2");

    const list = screen.getByRole("list", { name: "에셋 목록" });
    // 🔴 아래 문장은 **이유**만 말합니다. 숫자를 두 곳에 적으면 한쪽만 고쳐지는 날이 옵니다.
    expect(list.textContent).toContain("폴더를 열면 보입니다");
    expect(list.textContent, "개수는 위에서 한 번만").not.toContain("이미지 2개");
  });
});

/**
 * 레이아웃 덩어리 — 오른쪽 절반이 비어 있던 것, 그리고 스크롤이 두 겹이던 것.
 *
 * 🟠 눈에 보이는 폭과 스크롤은 짝이 못 봅니다(jsdom 에 레이아웃이 없습니다). 짝이 붙들 수 있는 건
 * **결정** 하나입니다 — *「고르기 전에는 오른쪽에 아무것도 안 그린다」*. 그 문장이 사라지면 빈 절반이
 * 돌아옵니다.
 */
describe("AssetLibraryScreen detail pane", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says nothing on the right until there is something to say", async () => {
    const response: ListAssetsResponse = { assets: [makeAssetFolder({ assetId: "F-1", displayName: "아리" })] };
    vi.stubGlobal("fetch", withGeneratedImages(vi.fn().mockResolvedValue(jsonResponse(200, response))));
    render(<AssetLibraryScreen onBack={() => {}} />);
    await screen.findByRole("list", { name: "에셋 목록" });

    // 🔴 전에는 여기 *「왼쪽 목록에서 항목을 선택하면 상세 정보가 여기에 표시됩니다」* 가 있었습니다 —
    // 화면 절반을 한 문장에 쓰면서, 고른 뒤에는 아무 쓸모가 없었습니다.
    expect(screen.queryByText(/왼쪽 목록에서 항목을 선택하면/)).toBeNull();
    expect(screen.queryByRole("region", { name: "에셋 상세" }), "고르기 전에는 상세 칸 자체가 없습니다").toBeNull();
  });

  it("opens the right side once something is chosen", async () => {
    // 🟠 이 반쪽이 없으면 위의 짝은 「상세 칸을 아예 안 그린다」는 구현으로도 초록입니다.
    const folder = makeAssetFolder({ assetId: "F-1", displayName: "아리" });
    const fetchMock = stubFetchByRoute({
      "GET /assets": { assets: [folder] } satisfies ListAssetsResponse,
      "GET /assets/F-1": { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true },
    });
    vi.stubGlobal("fetch", withGeneratedImages(fetchMock));
    render(<AssetLibraryScreen onBack={() => {}} />);

    fireEvent.click(await screen.findByText("아리"));
    expect(await screen.findByRole("region", { name: "에셋 상세" })).toBeTruthy();
  });
});
