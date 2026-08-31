import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { GeneratedImageLibraryService } from "./generated-image-library.service.js";
import { GeneratedImageBackfillService } from "./generated-image-backfill.service.js";
import { PLACEHOLDER_PNG } from "./placeholder-image.js";

/** Bigger than the placeholder, and still a decodable PNG — the listing refuses anything smaller as "not a real image". */
const REAL_PNG = (() => {
  const iend = PLACEHOLDER_PNG.subarray(PLACEHOLDER_PNG.length - 12);
  const withoutIend = PLACEHOLDER_PNG.subarray(0, PLACEHOLDER_PNG.length - 12);
  const payload = Buffer.alloc(256, 0x61);
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write("tEXt", 4, "ascii");
  payload.copy(chunk, 8);
  return Buffer.concat([withoutIend, chunk, iend]);
})();

let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "backfill-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const assets = new LocalAssetsRepository(root);
  const service = new GeneratedImageBackfillService(new GeneratedImageLibraryService(projects, projectsRoot), assets, projectsRoot);
  return { root, projectsRoot, projects, assets, service };
}

async function shortProjectWithImages(projectsRoot: string, projects: LocalProjectRepository, id: string, scenes: number[]) {
  const project = createStoredProject(id, `topic ${id}`, "2026-08-23T00:00:00.000Z");
  project.workflow_state = WorkflowState.Completed;
  await projects.create(project);
  const directory = path.join(projectsRoot, id, "images");
  await fs.mkdir(directory, { recursive: true });
  for (const scene of scenes) await fs.writeFile(path.join(directory, `scene${scene}.png`), REAL_PNG);
  return directory;
}

describe("GeneratedImageBackfillService", () => {
  /**
   * The repair that already existed was reachable only through approving or regenerating a scene — two things a
   * finished project never does again. So anything made before indexing existed kept its pictures on disk and
   * stayed out of the Library permanently, which is what a real Episode turned out to be. This is the way to
   * fix those without asking someone to press the right screens in the right order.
   *
   * Asserted as a pair with the skip below, because "register everything" and "register nothing" each pass one
   * half on its own — and re-registering a source that already has a Folder would rewrite descriptions a person
   * may have edited.
   */
  it("registers a finished project whose pictures never reached the Library", async () => {
    const { projectsRoot, projects, assets, service } = await setup();
    const directory = await shortProjectWithImages(projectsRoot, projects, "old_project", [1, 2, 3]);
    expect(await assets.hasGeneratedProjectFolder("old_project")).toBe(false);

    const report = await service.backfillAll();

    expect(report).toMatchObject({ registered: 1, skipped: 0, failed: 0 });
    expect(await assets.hasGeneratedProjectFolder("old_project")).toBe(true);
    const children = (await assets.list()).filter((asset) => !asset.is_folder && asset.source_project_id === "old_project");
    expect(children).toHaveLength(3);
    expect(children.every((child) => child.stored_path.startsWith(directory))).toBe(true);
  });

  it("leaves a source that already has a Folder alone, so running it twice changes nothing", async () => {
    const { projectsRoot, projects, assets, service } = await setup();
    await shortProjectWithImages(projectsRoot, projects, "old_project", [1, 2, 3]);
    await service.backfillAll();
    const child = (await assets.list()).find((asset) => !asset.is_folder && asset.source_project_id === "old_project")!;
    await assets.update(child.asset_id, { description: "사람이 쓴 설명" });

    const second = await service.backfillAll();

    expect(second).toMatchObject({ scanned: 1, registered: 0, skipped: 1, failed: 0 });
    expect((await assets.get(child.asset_id)).description).toBe("사람이 쓴 설명");
  });
});
