import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LongStoryBible } from "@ai-animation-studio/shared";
import { makeAssetFolder, stubFetchByRoute } from "../api/testUtils.js";
import { SupportingCastCard, supportingCardsOf } from "./SupportingCastCard.js";

const GATE = makeAssetFolder({ assetId: "ASSET-CHAR-GATE", assetType: "character", displayName: "문지기", childAssetIds: ["a", "b"] });
const MINI = makeAssetFolder({ assetId: "ASSET-CHAR-MINI", assetType: "character", displayName: "미니" });
const OFF = makeAssetFolder({ assetId: "ASSET-CHAR-OFF", assetType: "character", displayName: "꺼 둔 폴더", enabled: false });

function bible(overrides: Partial<LongStoryBible> = {}, cards: unknown = [
  { id: "c1", name: "새봄", role: "protagonist", appearance: "x", personality: "y", order: 1 },
  { id: "c2", name: "문지기", role: "supporting", appearance: "x", personality: "y", order: 2 },
  { id: "c3", name: "행인", role: "supporting", appearance: "x", personality: "y", order: 3 },
]): LongStoryBible {
  return { basic: { characterCards: cards }, world: {}, updatedAt: "2026-10-10T00:00:00.000Z", secrets: [], foreshadowing: [], ...overrides } as unknown as LongStoryBible;
}

const BIBLE = "GET /long-projects/p1/story-bible";
const PATCH = "PATCH /long-projects/p1/story-bible/supporting-character-asset-links";

function mockServer(routes: Record<string, unknown>, errors: Record<string, { status: number; body: unknown }> = {}) {
  const fetchMock = stubFetchByRoute({ "GET /assets?assetType=character": { assets: [GATE, MINI, OFF] }, ...routes }, errors);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const writes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map(([url, init]) => ({ method: (init as RequestInit | undefined)?.method ?? "GET", url: String(url), body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : undefined }))
    .filter((call) => call.method !== "GET");

describe("supportingCardsOf", () => {
  it("reads only supporting cards with an id and a name", () => {
    expect(supportingCardsOf(bible())).toEqual([{ id: "c2", name: "문지기" }, { id: "c3", name: "행인" }]);
    expect(supportingCardsOf(bible({}, "not a list"))).toEqual([]);
    expect(supportingCardsOf(bible({}, [{ id: "x", role: "supporting" }, null, { id: "y", name: "y", role: "supporting" }]))).toEqual([{ id: "y", name: "y" }]);
  });
});

describe("SupportingCastCard (M4)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows each supporting character with its saved folder and offers only enabled character folders", async () => {
    mockServer({ [BIBLE]: { storyBible: bible({ supportingCharacterAssetLinks: [{ characterId: "c2", assetId: "ASSET-CHAR-GATE" }] }) } });
    render(<SupportingCastCard projectId="p1" />);
    const select = (await screen.findByTestId("supporting-cast-select-c2")) as HTMLSelectElement;
    expect(select.value).toBe("ASSET-CHAR-GATE");
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "ASSET-CHAR-GATE", "ASSET-CHAR-MINI"]);
    expect((screen.getByTestId("supporting-cast-select-c3") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByTestId("supporting-cast-select-c1")).toBeNull();
    expect((screen.getByTestId("supporting-cast-save") as HTMLButtonElement).disabled).toBe(true);
  });

  /** 저장은 목록 전체를 바꾸는 요청 하나 — Provider 요청은 없다. */
  it("saves the whole list in one request and adopts the server's answer", async () => {
    const saved = bible({ supportingCharacterAssetLinks: [{ characterId: "c2", assetId: "ASSET-CHAR-GATE" }, { characterId: "c3", assetId: "ASSET-CHAR-MINI" }] });
    const fetchMock = mockServer({ [BIBLE]: { storyBible: bible({ supportingCharacterAssetLinks: [{ characterId: "c2", assetId: "ASSET-CHAR-GATE" }] }) }, [PATCH]: { storyBible: saved } });
    render(<SupportingCastCard projectId="p1" />);
    fireEvent.change(await screen.findByTestId("supporting-cast-select-c3"), { target: { value: "ASSET-CHAR-MINI" } });
    expect(screen.getByTestId("supporting-cast-dirty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("supporting-cast-save"));
    await screen.findByTestId("supporting-cast-saved");
    expect(writes(fetchMock)).toEqual([{ method: "PATCH", url: "/long-projects/p1/story-bible/supporting-character-asset-links", body: { links: [{ characterId: "c2", assetId: "ASSET-CHAR-GATE" }, { characterId: "c3", assetId: "ASSET-CHAR-MINI" }] } }]);
    expect(screen.queryByTestId("supporting-cast-dirty")).toBeNull();
  });

  it("sends an empty list to remove every link", async () => {
    const fetchMock = mockServer({ [BIBLE]: { storyBible: bible({ supportingCharacterAssetLinks: [{ characterId: "c2", assetId: "ASSET-CHAR-GATE" }] }) }, [PATCH]: { storyBible: bible() } });
    render(<SupportingCastCard projectId="p1" />);
    fireEvent.change(await screen.findByTestId("supporting-cast-select-c2"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("supporting-cast-save"));
    await screen.findByTestId("supporting-cast-saved");
    expect(writes(fetchMock)[0]!.body).toEqual({ links: [] });
  });

  it("will not save one folder for two supporting characters", async () => {
    const fetchMock = mockServer({ [BIBLE]: { storyBible: bible() } });
    render(<SupportingCastCard projectId="p1" />);
    fireEvent.change(await screen.findByTestId("supporting-cast-select-c2"), { target: { value: "ASSET-CHAR-GATE" } });
    fireEvent.change(screen.getByTestId("supporting-cast-select-c3"), { target: { value: "ASSET-CHAR-GATE" } });
    expect(screen.getByTestId("supporting-cast-duplicate")).toBeTruthy();
    expect((screen.getByTestId("supporting-cast-save") as HTMLButtonElement).disabled).toBe(true);
    expect(writes(fetchMock)).toEqual([]);
  });

  it("says a work made without the analysis has no supporting cards", async () => {
    mockServer({ [BIBLE]: { storyBible: bible({}, null) } });
    render(<SupportingCastCard projectId="p1" />);
    expect((await screen.findByTestId("supporting-cast-none")).textContent).toContain("소설에서 시작");
  });

  it("shows a fixed sentence when saving fails and keeps the choice", async () => {
    mockServer({ [BIBLE]: { storyBible: bible() } }, { [PATCH]: { status: 400, body: { code: "LONG_INVALID_REQUEST", message: "raw server text" } } });
    render(<SupportingCastCard projectId="p1" />);
    fireEvent.change(await screen.findByTestId("supporting-cast-select-c2"), { target: { value: "ASSET-CHAR-GATE" } });
    fireEvent.click(screen.getByTestId("supporting-cast-save"));
    const alert = await screen.findByTestId("supporting-cast-error");
    expect(alert.textContent).not.toContain("raw server text");
    await waitFor(() => expect((screen.getByTestId("supporting-cast-select-c2") as HTMLSelectElement).value).toBe("ASSET-CHAR-GATE"));
  });
});
