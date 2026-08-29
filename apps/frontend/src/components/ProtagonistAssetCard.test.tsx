import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeAsset, makeAssetFolder } from "../api/testUtils.js";
import { ProtagonistAssetCard } from "./ProtagonistAssetCard.js";

const bible = (protagonistAssetLink?: unknown) => ({
  storyBible: {
    basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [],
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...(protagonistAssetLink ? { protagonistAssetLink } : {}),
  },
});
const folder = makeAssetFolder({ assetId: "FOLDER-1", displayName: "이배드", assetType: "character", childAssetIds: ["A", "B", "C"] });

function renderCard(assets: unknown[], link?: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method) return jsonResponse(200, bible({ assetId: "FOLDER-1", versionPolicy: "follow_latest", pinnedVersion: null }));
    return String(input).startsWith("/assets") ? jsonResponse(200, { assets }) : jsonResponse(200, bible(link));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ProtagonistAssetCard projectId="long_test" />);
  return fetchMock;
}

describe("ProtagonistAssetCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * The card's own text said the folder name reaches the script, and its doc comment said the Asset was
   * "applied to every Episode". The first is true; the second is true of the name and not of the pictures, and
   * a person read it the reasonable way and linked the same folder by hand on every Episode. Until the server
   * seeds that mapping, the card has to say which half it actually does.
   */
  it("says the pictures are not carried to Episodes yet, and where to pick them", async () => {
    renderCard([folder], { assetId: "FOLDER-1", versionPolicy: "follow_latest", pinnedVersion: null });

    const notice = await screen.findByTestId("protagonist-scope-notice");
    expect(notice.textContent).toContain("이름만");
    // Naming the screen that does carry them: a limit with no next step reads as a dead end.
    expect(notice.textContent).toContain("참고 이미지 연결");
  });

  // Folders only, and this is the opposite of the Story Bible's per-item links, which refused them. A
  // character is the set of angles of one person; a single image is one pose. The server enforces the same
  // rule, so what the screen offers is what the server takes.
  it("offers character folders and nothing else", async () => {
    renderCard([
      folder,
      makeAssetFolder({ assetId: "FOLDER-BG", displayName: "배경 폴더", assetType: "background" }),
      makeAsset({ assetId: "IMG-1", displayName: "낱장 그림", assetType: "character", approved: true }),
    ]);

    const select = await screen.findByTestId("protagonist-select");
    const values = Array.from((select as HTMLSelectElement).options).map((option) => option.value);
    expect(values).toEqual(["", "FOLDER-1"]);
  });

  it("saves the folder with no pinned version", async () => {
    const fetchMock = renderCard([folder]);
    await screen.findByTestId("protagonist-select");

    fireEvent.change(screen.getByTestId("protagonist-select"), { target: { value: "FOLDER-1" } });
    fireEvent.click(screen.getByTestId("protagonist-save"));

    await screen.findByTestId("protagonist-saved");
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method)!;
    expect(String(patch[0])).toBe("/long-projects/long_test/story-bible/protagonist-asset-link");
    // A folder has no version of its own — its children carry those — so a number here would pin nothing.
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({
      assetLink: { assetId: "FOLDER-1", versionPolicy: "follow_latest", pinnedVersion: null },
    });
  });

  it("clears the protagonist by sending null", async () => {
    const fetchMock = renderCard([folder], { assetId: "FOLDER-1", versionPolicy: "follow_latest", pinnedVersion: null });
    await screen.findByTestId("protagonist-linked");

    fireEvent.change(screen.getByTestId("protagonist-select"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("protagonist-save"));

    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method)!;
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({ assetLink: null });
  });

  // The name is not copied at save time — it is read when the script is written — so renaming the folder is
  // how a person renames their protagonist. Saying so is what stops them looking for a name field here.
  it("says the folder name is the protagonist's name and where to change it", async () => {
    renderCard([folder]);
    await screen.findByTestId("protagonist-select");

    const card = screen.getByTestId("protagonist-card");
    expect(card.textContent).toContain("폴더 이름이 곧 주인공 이름");
    expect(card.textContent).toContain("이미지 보관함");
    expect(card.textContent).toContain("다음 대본부터");
  });

  it("names where to make a folder instead of showing an empty picker", async () => {
    renderCard([]);
    const notice = await screen.findByTestId("protagonist-none-available");
    expect(notice.textContent).toContain("이미지 보관함");
    expect(screen.queryByTestId("protagonist-select")).toBeNull();
    expect(screen.queryByTestId("protagonist-save")).toBeNull();
  });

  it("shows the linked protagonist by folder name rather than by its id", async () => {
    renderCard([folder], { assetId: "FOLDER-1", versionPolicy: "follow_latest", pinnedVersion: null });
    const line = await screen.findByTestId("protagonist-linked");
    expect(line.textContent).toContain("이배드");
    expect(line.textContent).not.toContain("FOLDER-1");
  });

  it("shows a safe error instead of the backend's own text when saving fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method) return jsonResponse(400, { code: "INVALID_REQUEST", message: "C:\\raw\\internal" });
      return String(input).startsWith("/assets") ? jsonResponse(200, { assets: [folder] }) : jsonResponse(200, bible());
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProtagonistAssetCard projectId="long_test" />);

    await screen.findByTestId("protagonist-select");
    fireEvent.change(screen.getByTestId("protagonist-select"), { target: { value: "FOLDER-1" } });
    fireEvent.click(screen.getByTestId("protagonist-save"));

    const error = await screen.findByTestId("protagonist-error");
    expect(error.textContent).not.toContain("raw");
  });
});
