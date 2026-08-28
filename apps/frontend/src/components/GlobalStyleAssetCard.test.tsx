import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeAsset } from "../api/testUtils.js";
import { GlobalStyleAssetCard } from "./GlobalStyleAssetCard.js";

const bible = (styleAssetLink?: unknown) => ({
  storyBible: { basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z", ...(styleAssetLink ? { styleAssetLink } : {}) },
});
const style = makeAsset({ assetId: "STYLE-1", displayName: "수채화", assetType: "style", version: 3, enabled: true, approved: true });

function renderCard(assets: unknown[], link?: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (init?.method) return jsonResponse(200, bible({ assetId: "STYLE-1", versionPolicy: "snapshot", pinnedVersion: 3 }));
    if (url.startsWith("/assets")) return jsonResponse(200, { assets });
    return jsonResponse(200, bible(link));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<GlobalStyleAssetCard projectId="long_test" />);
  return fetchMock;
}

describe("GlobalStyleAssetCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The card used to be titled "전체 비주얼 스타일" and described as "연결할 수 있습니다" — a name for a field and
  // a sentence about the app's plumbing. What a person needs to know is what the picture does to their work.
  it("says what the picture actually does", async () => {
    renderCard([style]);
    await screen.findByTestId("global-style-select");
    expect(screen.getByTestId("global-style-card").textContent).toContain("모든 회차의 모든 장면");
  });

  it("saves the chosen style with its version policy", async () => {
    const fetchMock = renderCard([style]);
    await screen.findByTestId("global-style-select");

    fireEvent.change(screen.getByTestId("global-style-select"), { target: { value: "STYLE-1" } });
    fireEvent.change(screen.getByLabelText("전체 그림체 버전 정책"), { target: { value: "snapshot" } });
    fireEvent.click(screen.getByTestId("global-style-save"));

    await screen.findByTestId("global-style-saved");
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method)!;
    expect(String(put[0])).toBe("/long-projects/long_test/story-bible/style-asset-link");
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ assetLink: { assetId: "STYLE-1", versionPolicy: "snapshot", pinnedVersion: 3 } });
  });

  // An empty dropdown with a save button beside it reads as broken. The way out is on another screen, so the
  // card names that screen and the exact thing to do there, and shows no control at all rather than a dead one.
  it("names where to get a style instead of showing an empty picker", async () => {
    renderCard([]);
    const notice = await screen.findByTestId("global-style-none-available");
    expect(notice.textContent).toContain("이미지 보관함");
    expect(notice.textContent).toContain("스타일");
    expect(screen.queryByTestId("global-style-select")).toBeNull();
    expect(screen.queryByTestId("global-style-save")).toBeNull();
  });

  it("shows the linked style by name rather than by its id", async () => {
    // The old line printed "STYLE-1 · pinned_version · v3" — three internal strings and no picture name.
    renderCard([style], { assetId: "STYLE-1", versionPolicy: "pinned_version", pinnedVersion: 3 });
    const line = await screen.findByTestId("global-style-asset-link");
    expect(line.textContent).toContain("수채화");
    expect(line.textContent).not.toContain("pinned_version");
  });

  it("shows a safe error instead of the backend's own text when saving fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method) return jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "C:\\raw\\internal" });
      return String(input).startsWith("/assets") ? jsonResponse(200, { assets: [style] }) : jsonResponse(200, bible());
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GlobalStyleAssetCard projectId="long_test" />);

    await screen.findByTestId("global-style-select");
    fireEvent.change(screen.getByTestId("global-style-select"), { target: { value: "STYLE-1" } });
    fireEvent.click(screen.getByTestId("global-style-save"));

    const error = await screen.findByTestId("global-style-error");
    expect(error.textContent).not.toContain("raw");
  });
});
