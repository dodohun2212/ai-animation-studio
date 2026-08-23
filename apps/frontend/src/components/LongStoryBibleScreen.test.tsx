import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeAsset, makeLongProject } from "../api/testUtils.js";
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
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByTestId("story-bible-validation-error")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fireEvent.change(screen.getByLabelText("Item ID"), { target: { value: "CHAR-1" } });
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Mina" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Mina revised" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Mina revised");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("keeps raw backend details out of the error UI and supports all five tabs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "C:\\absolute\\raw detail" })));
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_STORAGE_ERROR");
    expect(alert.textContent).not.toContain("absolute");
    for (const name of ["Characters", "Locations", "Props", "Secrets", "Foreshadowing"]) expect(screen.getByRole("tab", { name })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Check relationships" }));
    expect((await screen.findByLabelText("Relationship audit issues")).textContent).toContain("characters / CHAR-1 / locationId: missing LOC-404");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long_test/story-bible/relationship-audit");
    expect(fetchMock.mock.calls[3]?.[1]).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Refresh audit" }));
    await screen.findByTestId("relationship-audit-healthy");
    fireEvent.click(screen.getByRole("button", { name: "Refresh audit" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw");
    fireEvent.click(screen.getByRole("button", { name: "Retry audit" }));
    await screen.findByTestId("relationship-audit-healthy");
  });

  it("saves an approved Asset Library link with a pinned version and one-episode scope", async () => {
    const asset = makeAsset({ assetId: "ASSET-CHAR-1", displayName: "Mina reference", assetType: "character", version: 4, enabled: true, approved: true });
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
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Mina" } });
    fireEvent.change(screen.getByLabelText("Linked Asset"), { target: { value: asset.assetId } });
    fireEvent.change(screen.getByLabelText("Asset episode scope"), { target: { value: "episode" } });
    fireEvent.change(screen.getByLabelText("Asset episode number"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    await screen.findByTestId("asset-link-CHAR-1");
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ item: {
      name: "Mina", assetLink: { assetId: "ASSET-CHAR-1", versionPolicy: "pinned_version", pinnedVersion: 4, episodeScope: { mode: "episode", episode: 2 } },
    } });
    expect(screen.getByTestId("asset-link-CHAR-1").textContent).toContain("Episode 2");
  });

  it("sends an explicit null link when clearing an existing link", async () => {
    const linkedItem = { ...characterBible.characters[0], assetLink: { assetId: "ASSET-1", versionPolicy: "follow_latest" as const, pinnedVersion: null, episodeScope: { mode: "all" as const } } };
    const linkedBible = { ...characterBible, characters: [linkedItem] };
    const clearedBible = { ...characterBible };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: linkedBible }))
      .mockResolvedValueOnce(jsonResponse(200, { assets: [makeAsset({ assetId: "ASSET-1", approved: true })] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: makeLongProject({ id: "long_test" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { item: clearedBible.characters[0], storyBible: clearedBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByText("Mina");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Linked Asset"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
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
    fireEvent.change(screen.getByLabelText("Basic settings JSON"), { target: { value: '{"title":"Revised"}' } });
    fireEvent.change(screen.getByLabelText("World settings JSON"), { target: { value: '{"era":"future"}' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Save basic and world settings" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long_test/story-bible/content");
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ basic: { title: "Revised" }, world: { era: "future" } });

    fireEvent.change(screen.getByLabelText("Global style Asset"), { target: { value: style.assetId } });
    fireEvent.change(screen.getByLabelText("Global style version policy"), { target: { value: "snapshot" } });
    fireEvent.click(screen.getByRole("button", { name: "Save global style" }));
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
    fireEvent.change(screen.getByLabelText("World settings JSON"), { target: { value: "[]" } });
    fireEvent.click(screen.getByRole("button", { name: "Save basic and world settings" }));
    expect(screen.getByTestId("story-bible-content-validation-error").textContent).toContain("World settings");
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
    fireEvent.change(screen.getByLabelText("Search Characters"), { target: { value: "Mina" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByLabelText("Characters search results");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long_test/story-bible/characters/search?query=Mina");
    fireEvent.click(screen.getByLabelText("Characters search results").querySelector("button")!);
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
    fireEvent.change(screen.getByLabelText("Search Characters"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw");
    fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
    await screen.findByTestId("story-bible-search-empty");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/long-projects/long_test/story-bible/characters/search?query=missing");
  });
});
