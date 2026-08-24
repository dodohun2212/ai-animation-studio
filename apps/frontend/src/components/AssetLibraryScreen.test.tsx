import type { Asset, GetAssetResponse, ListAssetsResponse } from "@ai-animation-studio/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeAsset } from "../api/testUtils.js";
import { AssetLibraryScreen } from "./AssetLibraryScreen.js";

function searchForm(): HTMLFormElement {
  return screen.getByRole("button", { name: "검색" }).closest("form") as HTMLFormElement;
}
function importForm(): HTMLElement {
  return screen.getByRole("form", { name: "에셋 가져오기" });
}
function detailRegion(): HTMLElement {
  return screen.getByRole("region", { name: "에셋 상세" });
}
function editForm(): HTMLElement {
  return within(detailRegion()).getByRole("form", { name: "에셋 정보 편집" });
}

async function fillAndSubmitImport(file: File, name: string): Promise<void> {
  const form = importForm();
  fireEvent.change(within(form).getByLabelText("이미지 파일"), { target: { files: [file] } });
  fireEvent.change(within(form).getByLabelText("이름"), { target: { value: name } });
  fireEvent.click(within(form).getByRole("button", { name: "가져오기" }));
}

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
    vi.stubGlobal("fetch", fetchMock);

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
    vi.stubGlobal("fetch", fetchMock);

    render(<AssetLibraryScreen onBack={() => {}} initialQuery="my_project" />);

    await screen.findByText("등록된 에셋이 없습니다.");
    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.get("query")).toBe("my_project");
    expect((screen.getByLabelText("검색") as HTMLInputElement).value).toBe("my_project");
  });

  it("shows the empty state when the backend returns no assets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] })));
    render(<AssetLibraryScreen onBack={() => {}} />);

    expect(await screen.findByText("등록된 에셋이 없습니다.")).toBeTruthy();
  });

  it("shows a fixed, safe Korean message and identifiable code when the initial load fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "ASSET_STORAGE_ERROR", message: "disk failure at C:\\secret\\path" })));
    render(<AssetLibraryScreen onBack={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("에셋을 저장하거나 읽지 못했습니다.");
    expect(alert).toHaveAttribute("data-error-code", "ASSET_STORAGE_ERROR");
  });

  it("never renders the backend's raw message, details, path, or stack anywhere in the DOM", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {
      code: "ASSET_DATA_INVALID",
      message: "raw internal detail C:\\Users\\secret\\learning_data",
      details: { path: "C:\\Users\\secret", stack: "at Object.<anonymous> (file.ts:1:1)" },
    })));
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [folder, first, second] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { folder: updatedFolder, children: [second, first] }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [updatedFolder, second, first] }))
      .mockResolvedValueOnce(jsonResponse(200, { folder: representativeFolder, children: [second, first] }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [representativeFolder, second, first] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("Hero references"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const set = within(detail).getByRole("region", { name: "Character reference set" });
    expect(within(set).getByRole("list", { name: "Ordered character reference images" }).textContent).toContain("1. Front");

    fireEvent.click(within(set).getAllByRole("button", { name: "Move down" })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/assets/FOLDER-CHAR/character-reference-set");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ childAssetIds: ["CHAR-2", "CHAR-1"], thumbnailAssetId: "CHAR-1" });
    expect(within(set).getByRole("list", { name: "Ordered character reference images" }).textContent).toContain("1. Side");
    fireEvent.click(within(set).getAllByRole("button", { name: "Set representative" })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    const [representativeUrl, representativeInit] = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(representativeUrl).toBe("/assets/FOLDER-CHAR/character-reference-set");
    expect(JSON.parse(String(representativeInit.body))).toEqual({ childAssetIds: ["CHAR-2", "CHAR-1"], thumbnailAssetId: "CHAR-2" });
    expect(within(set).getByText(/Side \(representative\)/)).toBeTruthy();
    for (const [calledUrl] of fetchMock.mock.calls as Array<[string]>) {
      expect(calledUrl).toMatch(/^\/assets/);
      expect(calledUrl).not.toContain("/videos/");
      expect(calledUrl).not.toContain("providers");
    }
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: ["project_a"], ownership: "project_owned", canDeleteOwnedFile: false })));
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
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("삭제 가능"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByRole("button", { name: "목록에서 삭제" }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
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
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("삭제 가능"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByRole("button", { name: "목록에서 삭제" }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("삭제 대상"));
    await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detailRegion()).getByRole("button", { name: "목록에서 삭제" }));

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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("삭제 대상"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByRole("button", { name: "목록에서 삭제" }));

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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("재연결 대상"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const versionRegion = within(detail).getByRole("region", { name: "버전 기록" });
    const form = within(versionRegion).getByRole("form", { name: "파일 재연결" });

    const file = new File(["replacement-bytes"], "replacement.png", { type: "image/png" });
    fireEvent.change(within(form).getByLabelText("교체 이미지"), { target: { files: [file] } });
    fireEvent.click(within(form).getByRole("button", { name: "현재 버전 재연결" }));

    expect(confirmSpy.mock.calls.at(-1)?.[0]).toContain("재연결 대상");
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
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("재연결 대상"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const form = within(within(detail).getByRole("region", { name: "버전 기록" })).getByRole("form", { name: "파일 재연결" });
    fireEvent.change(within(form).getByLabelText("교체 이미지"), { target: { files: [new File(["x"], "x.png", { type: "image/png" })] } });
    fireEvent.click(within(form).getByRole("button", { name: "현재 버전 재연결" }));

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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("원본 삭제 대상"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(detail).getByRole("button", { name: "에셋과 원본 파일 함께 삭제" }));

    expect(confirmSpy.mock.calls.at(-1)?.[0]).toContain("원본 삭제 대상");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/assets/ASSET-OWNED/owned-file");
    expect(init.method).toBe("DELETE");
    await waitFor(() => expect(screen.queryByRole("region", { name: "에셋 상세" })).toBeNull());
  });

  it("does not offer owned-file deletion when the backend reports it is unsafe", async () => {
    const asset = makeAsset({ assetId: "ASSET-SHARED", displayName: "공유된 원본" });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false })));
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
    vi.stubGlobal("fetch", fetchMock);
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

  it("does not refresh the list when the legacy reference migration finds nothing to migrate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { projectsScanned: 1, migratedAssets: 0, deduplicatedAssets: 0, failedAssets: 0 }));
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [folder, first] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false }))
      .mockResolvedValueOnce(jsonResponse(200, { assetId: "FOLDER-CHAR", removedChildAssetIds: [], deletedFiles: 0 }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [first] }));
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("Hero references"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    expect(within(detail).queryByRole("button", { name: "목록에서 삭제" })).toBeNull();
    const folderDeleteSection = within(detail).getByRole("region", { name: "Folder 삭제" });

    fireEvent.click(within(folderDeleteSection).getByRole("button", { name: "Folder 삭제" }));

    expect(confirmSpy.mock.calls.at(-1)?.[0]).toContain("Hero references");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe("/assets/FOLDER-CHAR/folder");
    expect(init.method).toBe("DELETE");
    await waitFor(() => expect(screen.queryByRole("region", { name: "에셋 상세" })).toBeNull());
  });

  it("deletes a Folder together with its child indexes and owned files when both options are selected", async () => {
    const first = makeAsset({ assetId: "CHAR-1", assetType: "character", displayName: "Front", parentFolderId: "FOLDER-CHAR", sortOrder: 0 });
    const folder = makeAsset({ assetId: "FOLDER-CHAR", assetType: "character", displayName: "Hero references", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: ["CHAR-1"], thumbnailAssetId: "CHAR-1" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [folder, first] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false }))
      .mockResolvedValueOnce(jsonResponse(200, { assetId: "FOLDER-CHAR", removedChildAssetIds: ["CHAR-1"], deletedFiles: 1 }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("Hero references"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    const folderDeleteSection = within(detail).getByRole("region", { name: "Folder 삭제" });
    fireEvent.click(within(folderDeleteSection).getByLabelText("하위 항목의 원본 파일도 함께 삭제(수동 등록 항목만 가능)"));
    expect((within(folderDeleteSection).getByLabelText("하위 항목 색인도 함께 삭제") as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(folderDeleteSection).getByRole("button", { name: "Folder 삭제" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url] = fetchMock.mock.calls[2] as [string];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.get("removeChildIndexes")).toBe("true");
    expect(parsed.searchParams.get("deleteManualFiles")).toBe("true");
  });

  it("does not delete a Folder when the confirmation dialog is cancelled", async () => {
    const folder = makeAsset({ assetId: "FOLDER-CHAR", assetType: "character", displayName: "Hero references", isFolder: true, imageAvailable: false, contentSha256: "", versions: [], referenceImages: [], childAssetIds: [], thumbnailAssetId: "" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { assets: [folder] }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AssetLibraryScreen onBack={() => {}} />);

    const list = await screen.findByRole("list", { name: "에셋 목록" });
    fireEvent.click(within(list).getByText("Hero references"));
    const detail = await screen.findByRole("region", { name: "에셋 상세" });
    fireEvent.click(within(within(detail).getByRole("region", { name: "Folder 삭제" })).getByRole("button", { name: "Folder 삭제" }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("calls onBack when the back button is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] })));
    const onBack = vi.fn();
    render(<AssetLibraryScreen onBack={onBack} />);
    await screen.findByText("등록된 에셋이 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 목록으로" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

function _unusedTypeCheck(asset: Asset, response: GetAssetResponse): void {
  void asset;
  void response;
}
void _unusedTypeCheck;
