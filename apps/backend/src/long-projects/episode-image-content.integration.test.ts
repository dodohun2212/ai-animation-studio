import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { LongProjectsService } from "./long-projects.service.js";

/**
 * An Episode's generated images can be fetched.
 *
 * There was no route that served them at all, so the review screen had nothing to put in an <img> and showed
 * none — people were approving pictures, and paying to regenerate them, without ever seeing one.
 */

const settings = {
  title: "Content", logline: "l", overview: "o", genre: "g", tone: "t", theme: "th",
  episodeCount: 1, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const,
  audience: "a", notes: "n", startingState: "s", midpoint: "m", endingDirection: "e",
  storyFlowSummary: "f", narrationEnabled: false, subtitlesEnabled: false,
};

let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

async function generatedEpisode() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-image-content-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const preview = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot);
  await scripts.generate("long", 1, {});
  await scripts.approve("long", 1, { approved: true });
  await approveEpisodeMappingReview(projectsRoot, root, "long", 1);
  const images = new EpisodeImagesService(projectsRoot);
  await images.generate("long", 1, { approved: true });
  return { images, projectsRoot };
}

describe("an Episode scene's image content", () => {
  it("points at a file that is really there, for every scene that was generated", async () => {
    const { images } = await generatedEpisode();

    for (const scene of [1, 2, 3, 4, 5, 6]) {
      const { path: file } = await images.content("long", 1, String(scene));
      const stat = await fs.stat(file);
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBeGreaterThan(0);
      expect(file.endsWith(`scene${scene}.png`)).toBe(true);
    }
  });

  it("does not gate on the Episode's state — a picture that exists can be looked at", async () => {
    // A review screen that refuses to show the thing being reviewed is the failure this route exists to end.
    const { images, projectsRoot } = await generatedEpisode();
    const projectFile = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const episode = JSON.parse(await fs.readFile(projectFile, "utf8")) as Record<string, unknown>;
    await fs.writeFile(projectFile, JSON.stringify({ ...episode, state: "videos_approved" }), "utf8");

    await expect(images.content("long", 1, "1")).resolves.toMatchObject({ path: expect.stringContaining("scene1.png") });
  });

  it("refuses a scene the Episode does not have, rather than reaching for a file by name", async () => {
    const { images } = await generatedEpisode();
    for (const scene of ["7", "0", "-1", "abc", "1.5"]) {
      await expect(images.content("long", 1, scene)).rejects.toMatchObject({});
    }
  });

  it("refuses a scene that has not been generated", async () => {
    const { images, projectsRoot } = await generatedEpisode();
    await fs.rm(path.join(projectsRoot, "long", "long_story", "Episode01", "images", "scene3.png"));

    await expect(images.content("long", 1, "3")).rejects.toMatchObject({});
  });
});
