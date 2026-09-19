import { afterEach, describe, expect, it, vi } from "vitest";

import type { GeneratedEpisodeImageSummary, GeneratedImageSummary, SceneNumber } from "@ai-animation-studio/shared";

import {
  GeneratedImagesApiError,
  generatedEpisodeImageContentUrl,
  generatedImageContentUrl,
  getGeneratedImages,
} from "./generatedImagesApi.js";

/**
 * The image library's reader, which had no pairs of its own.
 *
 * 🔴 Found the same way as `openai-common.ts`: source files with no same-named test file, narrowed to the ones
 * that send a request. Two decisions in here were carrying real weight with nothing looking at them — the
 * deliberate asymmetry between a bad project row and a bad Episode row, and the cache-buster that is the only
 * reason a regenerated picture is the one you see.
 */

const image = (over: Partial<GeneratedImageSummary> = {}): GeneratedImageSummary => ({
  projectId: "p1",
  projectTitle: "우주 고양이",
  sceneNumber: 1 as SceneNumber,
  updatedAt: "2026-09-19T09:00:00.000Z",
  bytes: 1024,
  ...over,
});

const episodeImage = (over: Partial<GeneratedEpisodeImageSummary> = {}): GeneratedEpisodeImageSummary => ({
  ...image(),
  episodeNumber: 2,
  episodeTitle: "두 번째 회차",
  ...over,
});

const answering = (body: unknown, status = 200) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));

afterEach(() => { vi.unstubAllGlobals(); });

describe("reading the image library", () => {
  it("returns both lists when the answer is whole", async () => {
    answering({ projects: [image()], episodes: [episodeImage()] });
    const result = await getGeneratedImages();
    expect(result.projects).toHaveLength(1);
    expect(result.episodes).toHaveLength(1);
  });

  /**
   * 🔴 **The asymmetry is the design, and nothing was holding it.** A malformed *project* row means the answer
   * cannot be trusted and the whole read is refused. A malformed *Episode* row is dropped and the rest is
   * kept — because an Episode nobody can read must not cost somebody the short-project pictures they came to
   * look at. Tidying this into symmetry, in either direction, would be a one-line change that nothing noticed:
   * strict on both, and one broken Episode hides every picture; loose on both, and a garbled project row
   * reaches the screen as a card with no title.
   */
  it("refuses the whole answer over a bad project row", async () => {
    answering({ projects: [image(), { projectId: "" }], episodes: [] });
    await expect(getGeneratedImages()).rejects.toBeInstanceOf(GeneratedImagesApiError);
  });

  it("drops a bad Episode row and still hands back the projects", async () => {
    answering({ projects: [image()], episodes: [episodeImage(), { episodeNumber: 0 }, "not even an object"] });
    const result = await getGeneratedImages();
    expect(result.projects).toHaveLength(1);
    expect(result.episodes).toHaveLength(1);
  });

  /** A missing `episodes` key is an empty shelf, not a broken answer — the same leniency, one step further. */
  it("treats a missing episodes list as empty", async () => {
    answering({ projects: [image()] });
    expect((await getGeneratedImages()).episodes).toEqual([]);
  });

  /**
   * 🟠 A 5xx that does not even carry the backend's `{ code, message }` means the backend never answered — it
   * is down, restarting, or something in front of it replied. Saying "the response could not be read" blames
   * the body for a server that was not running.
   */
  it("says the server is not answering rather than blaming the response", async () => {
    answering("<html>502</html>", 502);
    const error = await getGeneratedImages().catch((caught: unknown) => caught) as GeneratedImagesApiError;
    expect(error.code).toBe("CLIENT_SERVER_UNAVAILABLE");
  });

  it("passes the backend's own refusal through when it sent one", async () => {
    answering({ code: "IMAGES_UNAVAILABLE", message: "그림 목록을 읽지 못했습니다." }, 500);
    const error = await getGeneratedImages().catch((caught: unknown) => caught) as GeneratedImagesApiError;
    expect(error.code).toBe("IMAGES_UNAVAILABLE");
  });

  it("reports an unreachable backend as a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(getGeneratedImages()).rejects.toBeInstanceOf(GeneratedImagesApiError);
  });
});

describe("where a listed picture's bytes are", () => {
  /**
   * 🔴 **The `?v=` is the whole reason a regenerated picture is the one you see.** The address of scene 1 never
   * changes, so a browser that cached it will replay the old bytes — and the person has just *paid* for the
   * new ones. Drop the parameter and the library shows the previous drawing after every regeneration, with
   * nothing failing and nothing to notice except that the picture looks wrong.
   */
  it("changes the address when the picture changes", () => {
    const before = generatedImageContentUrl(image({ updatedAt: "2026-09-19T09:00:00.000Z" }));
    const after = generatedImageContentUrl(image({ updatedAt: "2026-09-19T10:30:00.000Z" }));
    expect(before).not.toBe(after);
    // And the same picture keeps the same address, so nothing is refetched for no reason.
    expect(generatedImageContentUrl(image())).toBe(generatedImageContentUrl(image()));
  });

  /**
   * 🟠 Encoded, because an ISO timestamp carries colons. Unencoded they are legal in a query string but read
   * as a port delimiter by some proxies, and the bug that produces is a picture that loads on this machine and
   * not on another.
   */
  it("escapes the timestamp rather than pasting it in raw", () => {
    const url = generatedImageContentUrl(image({ updatedAt: "2026-09-19T09:00:00.000Z" }));
    expect(url).toContain("%3A");
    expect(url.split("?v=")[1]).not.toContain(":");
  });

  /** An Episode's picture is the same rule at a different address, and both carry the buster. */
  it("busts the cache for an Episode picture too", () => {
    const before = generatedEpisodeImageContentUrl(episodeImage({ updatedAt: "2026-09-19T09:00:00.000Z" }));
    const after = generatedEpisodeImageContentUrl(episodeImage({ updatedAt: "2026-09-19T10:30:00.000Z" }));
    expect(before).not.toBe(after);
    expect(before).toContain("%3A");
  });
});
