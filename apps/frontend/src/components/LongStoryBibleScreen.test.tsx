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
    // The description comes along now: picking a folder fills it from the folder's own, which is the point of
    // dropping the field — the person already typed it once when they made the Asset.
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ item: {
      name: "Mina", description: asset.description, assetLink: { assetId: "ASSET-CHAR-1", versionPolicy: "pinned_version", pinnedVersion: 4, episodeScope: { mode: "episode", episode: 2 } },
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

  it("edits world JSON only on save", async () => {
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
    // The 전체 스타일 half of this test moved with the control, to GlobalStyleAssetCard.test.tsx — it is a
    // project-wide choice and now sits in 작품 기본 설정 beside 화면 비율.
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

  // The two search/duplicate tests that were here are gone with the feature.
  // Searching only ever matched the items listed on the same screen, and its one action was to duplicate one —
  // a workaround from when an item could be scoped to a single Episode. Episodes pick their own references now,
  // and duplicating is actively harmful, because automatic matching keys on the name and a copy matches too.

  it("fills the item name from the chosen folder instead of asking for it twice", async () => {
    const folder = makeAssetFolder({ assetId: "FOLDER-1", displayName: "미나", description: "조종사", assetType: "character" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [folder] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    expect((screen.getByLabelText("항목 이름") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("연결할 에셋"), { target: { value: "FOLDER-1" } });

    expect((screen.getByLabelText("항목 이름") as HTMLInputElement).value).toBe("미나");
    // Said out loud, because a name that appeared on its own reads as something not to touch — and this one
    // has to be touched when the folder is called something the script never says.
    expect(screen.getByTestId("story-bible-name-from-folder")).toBeTruthy();
  });

  it("never overwrites a name the person typed themselves", async () => {
    // The counterpart the rule above needs. Filling the field in is only safe if it stops once it is theirs;
    // otherwise changing folders silently discards a correction, which is the screen undoing an edit.
    const first = makeAssetFolder({ assetId: "FOLDER-1", displayName: "이베드_최종_v3", assetType: "character" });
    const second = makeAssetFolder({ assetId: "FOLDER-2", displayName: "폴더2", assetType: "character" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [first, second] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    fireEvent.change(screen.getByLabelText("연결할 에셋"), { target: { value: "FOLDER-1" } });
    fireEvent.change(screen.getByLabelText("항목 이름"), { target: { value: "이베드" } });
    fireEvent.change(screen.getByLabelText("연결할 에셋"), { target: { value: "FOLDER-2" } });

    expect((screen.getByLabelText("항목 이름") as HTMLInputElement).value).toBe("이베드");
  });

  it("adds a world row that survives being blank until it is named", async () => {
    // The row list used to be derived from the stored JSON on every render, and a blank name is dropped on the
    // way into that JSON because it is not a valid key. So pressing 항목 추가 produced no row at all: the JSON
    // came back identical and re-deriving gave the list from before. To a person the button was simply dead.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    const rows = screen.getByTestId("story-bible-world-rows");
    fireEvent.click(within(rows).getByRole("button", { name: "세계관 설명에 항목 추가" }));

    const names = within(rows).getAllByLabelText("항목 이름");
    expect(names).toHaveLength(1);
    // And what is typed into it survives, which the old shape also lost: the value was written into a JSON
    // object under an empty key that was then thrown away.
    fireEvent.change(within(rows).getAllByLabelText("내용")[0]!, { target: { value: "바다 위 도시" } });
    expect(within(rows).getAllByLabelText("내용")[0]!).toHaveValue("바다 위 도시");
    fireEvent.change(names[0]!, { target: { value: "지역" } });
    expect(within(rows).getAllByLabelText("내용")[0]!).toHaveValue("바다 위 도시");
  });

  it("no longer offers a second editor for the project's own settings", async () => {
    // 작품 기본 정보 was a table over a server-made copy of title/logline/overview/genre/tone/theme/
    // ending_direction/audience. Editing the real settings does not update that copy, so the two drift and both
    // reach the script prompt disagreeing — and one of its buttons deleted the title.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    expect(screen.queryByTestId("story-bible-basic-rows")).toBeNull();
    // 세계관 설명 stays — it is the one of the two that is actually written here.
    expect(screen.getByTestId("story-bible-world-rows")).toBeTruthy();
  });

  // 비밀·복선 are the two collections whose text actually reaches the model, so their description is the item
  // — not the second copy of a folder's own name that was removed from 캐릭터·배경·소품.
  it("asks for the text of a secret, and for when it may be used", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(201, { item: { id: "SECRET-1", name: "출생의 비밀" }, storyBible: emptyBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    fireEvent.click(screen.getByRole("tab", { name: "비밀" }));
    fireEvent.change(screen.getByLabelText("항목 이름"), { target: { value: "출생의 비밀" } });
    fireEvent.change(screen.getByLabelText("항목 내용"), { target: { value: "이베드는 기록관이 만든 존재다." } });
    fireEvent.change(screen.getByLabelText("공개 가능 회차"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "항목 추가" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const body = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(body.item).toMatchObject({
      name: "출생의 비밀",
      description: "이베드는 기록관이 만든 존재다.",
      // The field the whole reveal split turns on. Without it every secret defaults to Episode 1 — always
      // revealable — and the "you must not use this yet" half of the prompt covers nothing.
      revealAvailableEpisode: 8,
    });
  });

  it("does not ask 캐릭터 for text nothing reads", async () => {
    // The counterpart: these two fields belong to 비밀·복선 only. Showing them on 캐릭터 would put back exactly
    // what was removed — a description that is sent nowhere, asked for beside a folder that already has one.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    expect(screen.queryByTestId("story-bible-item-content")).toBeNull();
    expect(screen.queryByTestId("story-bible-reveal-from")).toBeNull();
  });

  it("leaves the reveal Episode out of the request when it is blank", async () => {
    // Blank means "from the first Episode", which is what the server already defaults to. Sending 0 or NaN
    // instead would be a number the person never chose.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(201, { item: { id: "SECRET-1", name: "비밀" }, storyBible: emptyBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("story-bible-empty");
    fireEvent.click(screen.getByRole("tab", { name: "비밀" }));
    fireEvent.change(screen.getByLabelText("항목 이름"), { target: { value: "비밀" } });
    fireEvent.click(screen.getByRole("button", { name: "항목 추가" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const body = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(body.item).not.toHaveProperty("revealAvailableEpisode");
  });
});
