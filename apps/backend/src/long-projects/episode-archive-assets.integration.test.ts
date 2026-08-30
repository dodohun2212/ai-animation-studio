import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { EpisodeTimelineService } from "./episode-timeline.service.js";
import { LongProjectsService } from "./long-projects.service.js";

/**
 * An Episode's generated pictures are now Asset Library records that name `long_story/EpisodeNN` — a directory
 * `EpisodeTimelineService.archive()` renames, and `restoreArchive()` brings back under a different number.
 * Nothing reconciles the two: the project-level answer (`listExcludingArchivedProjects`) only knows about
 * `<projectsRoot>/.archive`.
 *
 * The reason the Library still cannot fill up with dead Episode pictures is in neither file — archiving is
 * refused unless every Episode is still a draft, so an Episode that has images can never be archived at all.
 * That is a gate two modules away from the records it protects, and relaxing it ("let me put away a finished
 * Episode") would break nothing that is currently red. This pins it.
 */
describe("archiving an Episode whose pictures the Asset Library is holding", () => {
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
  const settings = { title: "Exact long title", logline: "logline", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
  let learningRoot: string;
  let projectsRoot: string;
  let assets: LocalAssetsRepository;
  let timeline: EpisodeTimelineService;

  const episodeDirectory = () => path.join(projectsRoot, "long", "long_story", "Episode03");

  beforeEach(async () => {
    learningRoot = await fs.mkdtemp(path.join(os.tmpdir(), "episode-archive-assets-"));
    projectsRoot = path.join(learningRoot, "projects");
    assets = new LocalAssetsRepository(learningRoot);
    timeline = new EpisodeTimelineService(projectsRoot);
    await new LongProjectsService(projectsRoot).create({ projectId: "long", settings });
    await timeline.add("long", { title: "마지막 화" });
  });
  afterEach(async () => { await fs.rm(learningRoot, { recursive: true, force: true }); });

  /** Everything image generation leaves behind: the files on disk and the Library records that name them. */
  async function generateImages(): Promise<void> {
    const images = path.join(episodeDirectory(), "images");
    await fs.mkdir(images, { recursive: true });
    for (const scene of [1, 2]) await fs.writeFile(path.join(images, `scene${scene}.png`), image);
    await assets.indexGeneratedProjectImages({ sourceProjectId: "long/Episode03", imagesDirectory: images, kind: "long episode" }, "마지막 화", ["one", "two"]);
    const outlinesPath = path.join(projectsRoot, "long", "long_story", "episode_outlines.json");
    const outlines = JSON.parse(await fs.readFile(outlinesPath, "utf8")) as Array<Record<string, unknown>>;
    outlines[2]!.status = "images_review";
    await fs.writeFile(outlinesPath, JSON.stringify(outlines), "utf8");
  }

  it("is refused, so the Library keeps naming a directory that is still there", async () => {
    await generateImages();
    expect((await assets.listExcludingArchivedProjects()).length).toBe(3);

    await expect(timeline.archive("long", 3, { approved: true }))
      .rejects.toMatchObject({ response: { code: "LONG_EPISODE_TIMELINE_NOT_ALLOWED" } });

    // The Folder and its two pictures are still offered, and offering them is still honest.
    expect((await assets.listExcludingArchivedProjects()).length).toBe(3);
    await expect(fs.access(path.join(episodeDirectory(), "images", "scene1.png"))).resolves.toBeUndefined();
  });

  it("is allowed while the Episode is still a draft, which is what leaves the Library nothing to lose", async () => {
    await expect(timeline.archive("long", 3, { approved: true })).resolves.toMatchObject({ archivedEpisodeNumber: 3 });

    await expect(fs.access(episodeDirectory())).rejects.toBeTruthy();
    expect(await assets.listExcludingArchivedProjects()).toEqual([]);
  });
});
