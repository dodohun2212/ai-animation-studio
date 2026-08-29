import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubFetchByRoute } from "../api/testUtils.js";
import { InstagramPostScreen } from "./InstagramPostScreen.js";

const diagnostics = (overrides: Record<string, unknown> = {}) => ({
  pageCount: 0,
  pagesWithInstagramAccount: 0,
  missingPermissions: [],
  grantedPermissions: ["instagram_basic", "pages_show_list"],
  permissionsChecked: true,
  ...overrides,
});

function renderWith(targetsBody: unknown) {
  vi.stubGlobal("fetch", stubFetchByRoute({
    "GET /videos/library": { projects: [], episodes: [] },
    "GET /settings/instagram/targets": targetsBody,
  }));
  return render(<InstagramPostScreen onBack={() => {}} />);
}

describe("InstagramPostScreen — why the account list is empty", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the missing permission first, and says fixing Facebook will not help", async () => {
    // Checked first on purpose: someone told to "link a page" while the token lacks the scope does that work
    // and sees no change. This is also the case that had the person redoing setup they had already done.
    renderWith({ targets: [], diagnostics: diagnostics({ pageCount: 2, pagesWithInstagramAccount: 1, missingPermissions: ["instagram_content_publish"] }) });

    const panel = await screen.findByTestId("post-target-none");
    expect(panel.textContent).toContain("instagram_content_publish");
    expect(panel.textContent).toContain("다시 연결해야 합니다");
    // Not the linking story — that one is already true here and would send them nowhere.
    expect(panel.textContent).not.toContain("연결된 페이지가 없습니다");
  });

  it("says nothing about permissions when the permission check itself did not happen", async () => {
    // `missingPermissions: []` with `permissionsChecked: false` is "not looked at", not a clean bill. Reading
    // it as one would be exactly the confident wrong answer this panel exists to remove.
    renderWith({ targets: [], diagnostics: diagnostics({ pageCount: 0, permissionsChecked: false }) });

    const panel = await screen.findByTestId("post-target-none");
    expect(panel.textContent).not.toContain("권한");
    expect(panel.textContent).toContain("페이스북 페이지가 없습니다");
  });

  it("counts the pages it can see when none of them has an Instagram account", async () => {
    renderWith({ targets: [], diagnostics: diagnostics({ pageCount: 3, pagesWithInstagramAccount: 0 }) });

    const panel = await screen.findByTestId("post-target-none");
    expect(panel.textContent).toContain("페이스북 페이지 3개");
    expect(panel.textContent).toContain("연결된 페이지가 없습니다");
  });

  it("admits it does not know when every cause it can check comes back clean", async () => {
    // Pages exist, one has an Instagram account, nothing missing — and the list is still empty. Picking one of
    // the causes above here would be a guess wearing the clothes of a diagnosis.
    renderWith({ targets: [], diagnostics: diagnostics({ pageCount: 2, pagesWithInstagramAccount: 1 }) });

    const panel = await screen.findByTestId("post-target-none");
    expect(panel.textContent).toContain("원인을 여기서는 알 수 없습니다");
  });

  it("falls back to the old sentence when no diagnosis arrived at all", async () => {
    renderWith({ targets: [] });

    const panel = await screen.findByTestId("post-target-none");
    expect(panel.textContent).toContain("게시할 수 있는 인스타그램 계정이 없습니다");
  });

  it("keeps the screen working when the diagnosis itself is malformed", async () => {
    // Dropped rather than half-read: this panel exists to end a guess, and a diagnosis assembled from a broken
    // body would be a new one.
    renderWith({ targets: [], diagnostics: { pageCount: "2", pagesWithInstagramAccount: 1, missingPermissions: [], permissionsChecked: true } });

    const panel = await screen.findByTestId("post-target-none");
    expect(panel.textContent).toContain("게시할 수 있는 인스타그램 계정이 없습니다");
    expect(panel.textContent).not.toContain("페이스북 페이지 2개");
  });

  it("shows what the token actually holds, so a refused permission is not read as one never asked for", async () => {
    // Both produce the same empty `missingPermissions` when the app does not request a permission at all. The
    // granted set is the only line that separates "re-connect" from "the app asks for the wrong things".
    renderWith({ targets: [], diagnostics: diagnostics({ pageCount: 0, grantedPermissions: ["instagram_basic"] }) });

    expect((await screen.findByTestId("post-target-granted")).textContent).toContain("instagram_basic");
  });

  it("says 없음 rather than an empty line when the token holds nothing", async () => {
    renderWith({ targets: [], diagnostics: diagnostics({ grantedPermissions: [] }) });

    expect((await screen.findByTestId("post-target-granted")).textContent).toContain("없음");
  });

  it("does not list granted permissions when the check did not happen", async () => {
    // An unchecked list printed as fact is the same confident wrong answer this panel exists to remove.
    renderWith({ targets: [], diagnostics: diagnostics({ permissionsChecked: false }) });

    await screen.findByTestId("post-target-none");
    expect(screen.queryByTestId("post-target-granted")).toBeNull();
  });

});
