import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { AssetsService } from "../assets/assets.service.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";

/**
 * Archiving a project moves its directory; the Asset Library index keeps absolute paths into the old location.
 * Nothing in between reconciles the two, so what the Library shows and what it can actually open have to be
 * checked together — separately, both halves look fine.
 */
describe("archiving a project and its Asset Library entries", () => {
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
  let learningRoot: string;
  let projectsRoot: string;
  let assets: LocalAssetsRepository;
  let library: AssetsService;
  let service: ProjectsService;

  beforeEach(async () => {
    learningRoot = await fs.mkdtemp(path.join(os.tmpdir(), "archive-assets-"));
    projectsRoot = path.join(learningRoot, "projects");
    assets = new LocalAssetsRepository(learningRoot);
    library = new AssetsService(assets);
    service = new ProjectsService(new LocalProjectRepository(projectsRoot), assets);
    await service.createProject({ projectId: "short", topic: "Exact topic" });
    const images = path.join(projectsRoot, "short", "images");
    await fs.mkdir(images, { recursive: true });
    for (const scene of [1, 2]) await fs.writeFile(path.join(images, `scene${scene}.png`), image);
    await assets.indexGeneratedProjectImages({ sourceProjectId: "short", imagesDirectory: images, kind: "short project" }, "Exact topic", ["one", "two"]);
  });
  afterEach(async () => { await fs.rm(learningRoot, { recursive: true, force: true }); });

  it("hides the generated Folder while the project is archived and brings it back on restore", async () => {
    expect((await library.list()).assets.length).toBe(3);

    await service.archiveProject("short", { confirmation: "Exact topic" });

    // Not "the pictures are missing" — the Folder itself stops being offered, because every image in it now
    // resolves to a file that moved under .archive.
    expect((await library.list()).assets).toEqual([]);

    await service.restoreProject("short");
    expect((await library.list()).assets.length).toBe(3);
    expect((await library.list()).assets.every((asset) => asset.isFolder || asset.imageAvailable)).toBe(true);
  });

  it("drops the records for good only when the archived project is deleted for good", async () => {
    await service.archiveProject("short", { confirmation: "Exact topic" });
    expect((await assets.list()).length).toBe(3);

    await service.deleteArchivedProject("short", { confirmation: "Exact topic" });

    expect(await assets.list()).toEqual([]);
    await expect(fs.access(path.join(projectsRoot, ".archive", "short"))).rejects.toBeTruthy();
  });
});
