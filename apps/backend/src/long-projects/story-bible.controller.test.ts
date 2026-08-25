import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HttpStatus } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleController } from "./story-bible.controller.js";
import { StoryBibleService } from "./story-bible.service.js";

let root: string | undefined;
const settings = { title: "Long project", logline: "A local story", overview: "", genre: "", tone: "", theme: "", episodeCount: 1, sceneCount: 6, clipDurationSeconds: 5, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "" };
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("StoryBibleController", () => {
  it("exposes local CRUD and maps a missing item to its safe 404 error", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-controller-")); const projectsRoot = path.join(root, "projects");
    await new LongProjectsService(projectsRoot).create({ projectId: "long_bible", settings });
    const controller = new StoryBibleController(new StoryBibleService(projectsRoot));
    expect((await controller.create("long_bible", "locations", { item: { id: "LOC-1", name: "Library" } })).item.id).toBe("LOC-1");
    expect((await controller.get("long_bible")).storyBible.locations).toHaveLength(1);
    try { await controller.delete("long_bible", "locations", "LOC-2"); throw new Error("Expected missing item error"); }
    catch (error) { expect((error as { getStatus(): number }).getStatus()).toBe(HttpStatus.NOT_FOUND); expect((error as { getResponse(): { code: string } }).getResponse().code).toBe("STORY_BIBLE_ITEM_NOT_FOUND"); }
  });

  it("exposes the read-only relationship audit route", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-controller-")); const projectsRoot = path.join(root, "projects");
    await new LongProjectsService(projectsRoot).create({ projectId: "long_bible", settings }); const controller = new StoryBibleController(new StoryBibleService(projectsRoot));
    await controller.create("long_bible", "characters", { item: { id: "CHAR-1", locationId: "LOC-MISSING" } });
    await expect(controller.relationshipAudit("long_bible")).resolves.toEqual({ issues: [{ collection: "characters", itemId: "CHAR-1", field: "locationId", missingIds: ["LOC-MISSING"] }] });
    await expect(controller.relationshipAudit("../unsafe")).rejects.toMatchObject({ response: { code: "UNSAFE_PROJECT_ID" } });
  });

  it("exposes separate Story Bible content and global style-link mutations", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-controller-")); const projectsRoot = path.join(root, "projects");
    await new LongProjectsService(projectsRoot).create({ projectId: "long_bible", settings }); const controller = new StoryBibleController(new StoryBibleService(projectsRoot));
    await expect(controller.updateContent("long_bible", { basic: { title: "Edited" }, world: { era: "future" } })).resolves.toMatchObject({ storyBible: { basic: { title: "Edited" }, world: { era: "future" } } });
    await expect(controller.updateStyleAssetLink("long_bible", { assetLink: null })).resolves.toMatchObject({ storyBible: { basic: { title: "Edited" } } });
    await expect(controller.updateContent("long_bible", { basic: {}, world: {}, extra: true } as never)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("exposes the Story Bible search and duplicate routes", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-controller-")); const projectsRoot = path.join(root, "projects");
    await new LongProjectsService(projectsRoot).create({ projectId: "long_bible", settings }); const controller = new StoryBibleController(new StoryBibleService(projectsRoot));
    await controller.create("long_bible", "locations", { item: { id: "LOC-1", name: "도서관", description: "비밀 장소" } });
    expect(await controller.search("long_bible", "locations", " 장소 ")).toEqual({ items: [expect.objectContaining({ id: "LOC-1", name: "도서관" })] });
    const copy = await controller.duplicate("long_bible", "locations", "LOC-1");
    expect(copy.item).toMatchObject({ id: expect.stringMatching(/^LOC-[A-F0-9]{8}$/), name: "도서관 복사본", description: "비밀 장소" });
    await expect(controller.search("long_bible", "bad", "x")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(controller.duplicate("long_bible", "locations", "LOC-MISSING")).rejects.toMatchObject({ response: { code: "STORY_BIBLE_ITEM_NOT_FOUND" } });
  });
});
