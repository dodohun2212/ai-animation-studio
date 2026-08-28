import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeAsset, makeAssetFolder, makeLongProject } from "../api/testUtils.js";
import { LongStoryBibleScreen } from "./LongStoryBibleScreen.js";

const emptyBible = { basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" };
const characterBible = { ...emptyBible, characters: [{ id: "CHAR-1", name: "Mina", description: "pilot", status: "active" }] };

describe("LongStoryBibleScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads an empty collection, validates name locally, and creates an item", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(201, { item: characterBible.characters[0], storyBible: characterBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    expect(await screen.findByTestId("story-bible-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "항목 추가" }));
    expect(screen.getByTestId("story-bible-validation-error")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fireEvent.change(screen.getByLabelText("항목 ID"), { target: { value: "CHAR-1" } });
    fireEvent.change(screen.getByLabelText("항목 이름"), { target: { value: "Mina" } });
    fireEvent.click(screen.getByRole("button", { name: "항목 추가" }));
    await screen.findByText("Mina");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long_test/story-bible/characters");
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: "POST" });
  });

  it("edits an item and requires an explicit second action before delete", async () => {
    const revised = { ...characterBible, characters: [{ ...characterBible.characters[0], name: "Mina revised" }] };
    const deleted = { ...emptyBible };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: characterBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { item: revised.characters[0], storyBible: revised }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: deleted }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByText("Mina");
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("항목 이름"), { target: { value: "Mina revised" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 사항 저장" }));
    await screen.findByText("Mina revised");
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("keeps raw backend details out of the error UI and supports all five tabs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "C:\\absolute\\raw detail" })));
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_STORAGE_ERROR");
    expect(alert.textContent).not.toContain("absolute");
    for (const name of ["캐릭터", "배경", "소품", "비밀", "복선"]) expect(screen.getByRole("tab", { name })).toBeTruthy();
  });

  it("shows a read-only relationship audit with deterministic issues, healthy state, and safe retry errors", async () => {
    const issue = { collection: "characters" as const, itemId: "CHAR-1", field: "locationId" as const, missingIds: ["LOC-404"] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { issues: [issue] }))
      .mockResolvedValueOnce(jsonResponse(200, { issues: [] }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "C:\\raw\\internal" }))
      .mockResolvedValueOnce(jsonResponse(200, { issues: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    fireEvent.click(screen.getByRole("button", { name: "연결 상태 확인" }));
    expect((await screen.findByLabelText("연결 상태 문제 목록")).textContent).toContain("characters / CHAR-1 / locationId: LOC-404");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long_test/story-bible/relationship-audit");
    expect(fetchMock.mock.calls[3]?.[1]).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    await screen.findByTestId("relationship-audit-healthy");
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByTestId("relationship-audit-healthy");
  });

  it("saves an approved Asset Library link with a pinned version and one-episode scope", async () => {
    // 등장인물 links to a Folder. Folders are created with `approved: false` and the backend cannot flip that
    // flag on one, so the enabled/approved gate deliberately does not apply to them here.
    const asset = makeAssetFolder({ assetId: "ASSET-CHAR-1", displayName: "Mina reference", assetType: "character", version: 4, enabled: true, approved: false, childAssetIds: ["ASSET-CHAR-1-FRONT"] });
    const linkedItem = {
      ...characterBible.characters[0], assetLink: {
        assetId: asset.assetId, versionPolicy: "pinned_version" as const, pinnedVersion: 4,
        episodeScope: { mode: "episode" as const, episode: 2 },
      },
    };
    const linkedBible = { ...characterBible, characters: [linkedItem] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [asset, makeAsset({ assetId: "ASSET-DISABLED", enabled: false, approved: true })] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test", episodeCount: 3 }) }))
      .mockResolvedValueOnce(jsonResponse(201, { item: linkedItem, storyBible: linkedBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    fireEvent.change(screen.getByLabelText("항목 이름"), { target: { value: "Mina" } });
    fireEvent.change(screen.getByLabelText("연결할 에셋"), { target: { value: asset.assetId } });
    fireEvent.change(screen.getByLabelText("에셋 적용 범위"), { target: { value: "episode" } });
    fireEvent.change(screen.getByLabelText("적용할 에피소드 번호"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "항목 추가" }));

    await screen.findByTestId("asset-link-CHAR-1");
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ item: {
      name: "Mina", assetLink: { assetId: "ASSET-CHAR-1", versionPolicy: "pinned_version", pinnedVersion: 4, episodeScope: { mode: "episode", episode: 2 } },
    } });
    expect(screen.getByTestId("asset-link-CHAR-1").textContent).toContain("에피소드 2");
  });

  it("does not offer a loose character drawing as a 등장인물 link — only the Folder it belongs to", async () => {
    const folder = makeAssetFolder({ assetId: "ASSET-CHAR-FOLDER", displayName: "Mina", assetType: "character", childAssetIds: ["ASSET-CHAR-SIDE"] });
    const child = makeAsset({ assetId: "ASSET-CHAR-SIDE", displayName: "Mina 옆모습", assetType: "character", parentFolderId: folder.assetId, approved: true });
    const loose = makeAsset({ assetId: "ASSET-CHAR-LOOSE", displayName: "이름 없는 스케치", assetType: "character", approved: true });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [folder, child, loose] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    const select = screen.getByLabelText("연결할 에셋");
    // The folder is offered, and its option says how many drawings are inside it.
    expect(within(select).getByRole("option", { name: /Mina \(폴더 · 이미지 1장\)/ })).toBeTruthy();
    // Neither the drawing inside the folder nor a folderless one is a character on its own.
    expect(within(select).queryByRole("option", { name: /Mina 옆모습/ })).toBeNull();
    expect(within(select).queryByRole("option", { name: /이름 없는 스케치/ })).toBeNull();
  });

  it("sends an explicit null link when clearing an existing link", async () => {
    const linkedItem = { ...characterBible.characters[0], assetLink: { assetId: "ASSET-1", versionPolicy: "follow_latest" as const, pinnedVersion: null, episodeScope: { mode: "all" as const } } };
    const linkedBible = { ...characterBible, characters: [linkedItem] };
    const clearedBible = { ...characterBible };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: linkedBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [makeAssetFolder({ assetId: "ASSET-1", assetType: "character" })] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { item: clearedBible.characters[0], storyBible: clearedBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByText("Mina");
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("연결할 에셋"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 사항 저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).item.assetLink).toBeNull();
  });

  it("edits basic/world JSON only on save and links one approved global style asset", async () => {
    const style = makeAsset({ assetId: "STYLE-1", displayName: "Watercolor", assetType: "style", version: 3, enabled: true, approved: true });
    const contentBible = { ...emptyBible, basic: { title: "Revised" }, world: { era: "future" } };
    const styledBible = { ...contentBible, styleAssetLink: { assetId: style.assetId, versionPolicy: "snapshot" as const, pinnedVersion: 3 } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [style, makeAsset({ assetId: "NOT-STYLE", assetType: "character", approved: true })] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: contentBible }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: styledBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    fireEvent.change(screen.getByLabelText("기본 설정 JSON"), { target: { value: '{"title":"Revised"}' } });
    fireEvent.change(screen.getByLabelText("세계관 설정 JSON"), { target: { value: '{"era":"future"}' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "기본·세계관 설정 저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long_test/story-bible/content");
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ basic: { title: "Revised" }, world: { era: "future" } });

    fireEvent.change(screen.getByLabelText("전체 스타일 에셋"), { target: { value: style.assetId } });
    fireEvent.change(screen.getByLabelText("전체 스타일 버전 정책"), { target: { value: "snapshot" } });
    fireEvent.click(screen.getByRole("button", { name: "전체 스타일 저장" }));
    await screen.findByTestId("global-style-asset-link");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/long-projects/long_test/story-bible/style-asset-link");
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ assetLink: { assetId: "STYLE-1", versionPolicy: "snapshot", pinnedVersion: 3 } });
  });

  it("validates basic and world values as JSON objects before making a request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    fireEvent.change(screen.getByLabelText("세계관 설정 JSON"), { target: { value: "[]" } });
    fireEvent.click(screen.getByRole("button", { name: "기본·세계관 설정 저장" }));
    expect(screen.getByTestId("story-bible-content-validation-error").textContent).toContain("세계관 설정");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("searches only when explicitly submitted, shows retry-safe results, and duplicates locally", async () => {
    const copied = { id: "CHAR-2", name: "Mina copy", description: "pilot", status: "active" };
    const copiedBible = { ...characterBible, characters: [...characterBible.characters, copied] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: characterBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [characterBible.characters[0]] }))
      .mockResolvedValueOnce(jsonResponse(201, { item: copied, storyBible: copiedBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByText("Mina");
    fireEvent.change(screen.getByLabelText("캐릭터 검색"), { target: { value: "Mina" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByLabelText("캐릭터 검색 결과");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long_test/story-bible/characters/search?query=Mina");
    fireEvent.click(screen.getByLabelText("캐릭터 검색 결과").querySelector("button")!);
    await screen.findAllByText("Mina copy");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/long-projects/long_test/story-bible/characters/CHAR-1/duplicate");
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: "POST" });
  });

  it("shows a safe search error and retries the same explicit query", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "C:\\raw\\internal" }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    fireEvent.change(screen.getByLabelText("캐릭터 검색"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw");
    fireEvent.click(screen.getByRole("button", { name: "다시 검색" }));
    await screen.findByTestId("story-bible-search-empty");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/long-projects/long_test/story-bible/characters/search?query=missing");
  });

  it("does not claim an effect this screen does not have", async () => {
    // The intro used to promise that what you type here keeps a character's look and personality steady across
    // Episodes. Neither half held: the script prompt is built without characters/locations/props (their arrays
    // are documented as "always empty today"), and reference images reach generation through the Asset mapping
    // screen, not this one. Only 비밀·복선 actually travel. Pinned as a claim, not as wording — if the wiring
    // lands, this test should be changed deliberately alongside it, not quietly deleted.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { storyBible: emptyBible })));
    render(<LongStoryBibleScreen projectId="long" onBack={() => {}} />);

    await screen.findByRole("heading", { name: "등장인물·설정집" });
    expect(document.body.textContent).not.toContain("생김새·성격이 흔들리지 않게");
    expect(document.body.textContent).toContain("비밀·복선");
  });
});
