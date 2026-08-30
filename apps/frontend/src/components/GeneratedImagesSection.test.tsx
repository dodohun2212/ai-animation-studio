import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubFetchByRoute, withStatus } from "../api/testUtils.js";
import { GeneratedImagesSection } from "./GeneratedImagesSection.js";

const shortImage = (overrides: Record<string, unknown> = {}) => ({
  projectId: "1",
  projectTitle: "이배드의 탄생",
  sceneNumber: 3,
  updatedAt: "2026-08-28T09:00:00.000Z",
  bytes: 1_800_000,
  ...overrides,
});

const episodeImage = (overrides: Record<string, unknown> = {}) => ({
  ...shortImage({ projectId: "12", projectTitle: "이배드 연대기" }),
  episodeNumber: 1,
  episodeTitle: "첫 번째 밤",
  ...overrides,
});

const LISTING = "GET /images/generated";

describe("GeneratedImagesSection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows each picture at the address its own review screen uses, with the project and scene named", async () => {
    // The same bytes behind a second URL would be a second opinion about where they live, so the row points at
    // the existing content route. `updatedAt` rides along as the cache-buster: regenerating a scene keeps the
    // address and would otherwise replay the picture that was rejected.
    vi.stubGlobal("fetch", stubFetchByRoute({ [LISTING]: { projects: [shortImage()], episodes: [] } }));
    render(<GeneratedImagesSection />);

    const row = await screen.findByTestId("generated-image-1-3");
    expect(row.textContent).toContain("이배드의 탄생");
    expect(row.textContent).toContain("3번 장면");
    const src = row.querySelector("img")!.getAttribute("src") ?? "";
    expect(src).toContain("/projects/1/images/3/content");
    expect(src).toContain("v=2026-08-28T09%3A00%3A00.000Z");
  });

  /**
   * The count used to be the only thing said before the list opened, and the short project's grid is what
   * appears first. Someone looking for an Episode's pictures scanned that grid, did not find them, and reported
   * the library as not collecting them — while they sat four rows further down, already counted in the total.
   */
  it("says how the total splits before anything is opened", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ [LISTING]: {
      projects: [shortImage(), shortImage({ sceneNumber: 4 })],
      episodes: [episodeImage()],
    } }));
    render(<GeneratedImagesSection />);

    expect((await screen.findByTestId("generated-images-split")).textContent).toContain("단편 2");
    expect(screen.getByTestId("generated-images-split").textContent).toContain("장기 회차 1");
    // The first grid stops being the unlabelled default once there is a second one under it.
    expect(screen.getByText("단편 프로젝트")).toBeTruthy();
  });

  it("says nothing about a split when only one kind exists", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ [LISTING]: { projects: [shortImage()], episodes: [] } }));
    render(<GeneratedImagesSection />);

    await screen.findByTestId("generated-image-1-3");
    // One kind on screen: a heading and a breakdown would both be noise about a division that is not there.
    expect(screen.queryByTestId("generated-images-split")).toBeNull();
    expect(screen.queryByText("단편 프로젝트")).toBeNull();
  });

  it("addresses an Episode's picture through the Episode route, not the short project's", async () => {
    // Two arrays exist precisely because these live behind different routes. A row that lost that difference
    // would be a link to nowhere.
    vi.stubGlobal("fetch", stubFetchByRoute({ [LISTING]: { projects: [], episodes: [episodeImage()] } }));
    render(<GeneratedImagesSection />);

    const row = await screen.findByTestId("generated-episode-image-12-1-3");
    expect(row.textContent).toContain("이배드 연대기 · 1화");
    expect(row.querySelector("img")!.getAttribute("src")).toContain("/long-projects/12/episodes/1/images/3/content");
  });

  it("draws nothing at all when nothing has been generated yet", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ [LISTING]: { projects: [], episodes: [] } }));
    const { container } = render(<GeneratedImagesSection />);

    await waitFor(() => expect(screen.queryByTestId("generated-images")).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("says so when the listing cannot be read, rather than looking like an empty library", async () => {
    // Silence here would read as "you have no pictures", which is a different and wrong statement.
    vi.stubGlobal("fetch", stubFetchByRoute({ [LISTING]: withStatus(500, { code: "IMAGE_STORAGE_ERROR", message: "raw C:\\private" }) }));
    render(<GeneratedImagesSection />);

    const alert = await screen.findByTestId("generated-images-error");
    expect(alert).toHaveAttribute("data-error-code", "CLIENT_UNKNOWN_ERROR");
    // The backend's own message and any path in it never reach the screen.
    expect(document.body.textContent).not.toContain("C:\\private");
  });

  it("keeps the short rows when an Episode row is malformed", async () => {
    // A broken Episode row must not cost the person the pictures they can still use — the same rule the video
    // library follows.
    vi.stubGlobal("fetch", stubFetchByRoute({
      [LISTING]: { projects: [shortImage()], episodes: [{ ...episodeImage(), episodeNumber: "1" }] },
    }));
    render(<GeneratedImagesSection />);

    await screen.findByTestId("generated-image-1-3");
    expect(screen.queryByTestId("generated-images-episodes")).toBeNull();
  });
});
